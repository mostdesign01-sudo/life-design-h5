// Still-image staging for the poster and the promo's opening shot, injected into planet.html.
// enter() sits the traveler on the bench at sunset, scales the pair up so they read at thumbnail
// size and clears everything that would compete with them; leave() puts every change back, so the
// promo can cut straight from the staged opening to the live planet. The product is unchanged.
(() => {
  const P = window.__planet;
  const T = P.traveler;
  const V = P.player.dir.constructor;
  const world = P.world;
  const bench = world.objects.bench.parts[0];
  const sky = world.sky.material;
  const light = (() => { let found = null; world.scene.traverse(n => { if (!found && n.isDirectionalLight && n.castShadow) found = n; }); return found; })();
  const SKY_SHADER = sky.fragmentShader;
  // A smaller, crisper sun than the live sky's wide glow, so it stays a shape rather than a wash.
  const STAGED_SHADER = SKY_SHADER
    .replace("pow(s, 8.0) * 0.5", "pow(s, 24.0) * 0.28")
    .replace("pow(s, 64.0) * 0.7", "pow(s, 300.0) * 0.3")
    .replace("vec3(1.0, 0.96, 0.86) * 3.0", "vec3(1.0, 0.93, 0.78) * 1.15")
    .replace("smoothstep(0.9988, 0.9994, s)", "smoothstep(0.99945, 0.9997, s)");

  // The backpack, set down against the bench's right leg: just the bag, no bedroll, ties or lamp.
  const pack = T.pack.clone(true);
  pack.position.set(0.6, 0.2, -0.02);
  pack.rotation.set(0, -0.25, 0.06);
  pack.children.forEach(c => {
    const hex = c.material && c.material.color && c.material.color.getHexString();
    if (c.isGroup || hex === "d4553a" || hex === "3b2a20") c.visible = false;
  });
  pack.visible = false;
  bench.add(pack);

  // Grass, flowers and pebbles are the three big instanced scatters.
  const scatters = [];
  world.scene.traverse(n => {
    if (n.isInstancedMesh && (n.count > 3000 || ["CircleGeometry", "IcosahedronGeometry"].includes(n.geometry.type))) scatters.push(n);
  });
  const ironMats = [];
  bench.traverse(n => { if (n.material && n.material.metalness > 0 && !ironMats.includes(n.material)) ironMats.push(n.material); });
  const ironSaved = ironMats.map(m => [m.metalness, m.roughness]);
  const hidden = () => [world.clouds, world.objects.sign.parts[0], world.objects.lanterns.parts[0], ...scatters];

  const seat = new V();
  const focusTmp = new V();
  const render = world.render;
  let saved = null;
  let clear = 0;
  let lockFocus = false;
  let held = false;

  function pose() {
    bench.updateMatrixWorld();
    seat.set(0, 0.32 - 0.38, 0.07);
    bench.localToWorld(seat);
    T.group.position.copy(seat);
    T.group.quaternion.copy(bench.quaternion);
    T.legs.forEach((l, i) => { l.rotation.x = -1.45; l.rotation.z = (i ? -1 : 1) * 0.06; });
    T.arms.forEach((a, i) => { a.rotation.x = -0.55; a.rotation.z = (i ? 1 : -1) * 0.12; });
    T.body.position.y = 0;
    T.body.scale.set(1, 1, 1);
    T.head.rotation.set(-0.12, 0, 0);
    // Trees and bushes near the bench would compete with it; the world resets their visibility
    // every update, so this runs just before each render.
    if (clear > 0) [...world.trees, ...world.bushes].forEach(o => { if (o.position.angleTo(world.objects.bench.dir) < clear) o.visible = false; });
    // Keep the tilt-shift band on the bench in the staged shot, and on the whole planet while a
    // cut holds the seat, whatever camera mode the page is in.
    if (lockFocus) {
      const y = (lockFocus === "planet" ? focusTmp.set(0, 0, 0) : focusTmp.copy(seat)).project(world.camera).y * 0.5 + 0.5;
      world.setFocus(Math.min(0.9, Math.max(0.1, y)), true);
    }
  }

  window.__stage = {
    enter({ props = 1.8, clearAngle = 0 } = {}) {
      if (saved) return;
      clear = clearAngle;
      lockFocus = true;
      saved = { sun: sky.uniforms.uSunDir.value.clone(), light: light.position.clone(), visible: hidden().map(o => o.visible) };
      hidden().forEach(o => { o.visible = false; });
      ironMats.forEach(m => { m.metalness = 0; m.roughness = 1; });
      sky.fragmentShader = STAGED_SHADER;
      sky.needsUpdate = true;
      bench.scale.setScalar(props);
      T.group.scale.setScalar(props);
      T.pack.visible = false;
      T.arms[1].children.forEach(c => { if (c.geometry && c.geometry.type === "CylinderGeometry") c.visible = false; });
      pack.visible = true;
      world.render = (cam, time) => { pose(); render(cam, time); };
    },
    // Put the sun at a point on screen (NDC) for the current camera, and light the scene from it.
    placeSun(ndc) {
      const camera = world.camera;
      const dir = new V(ndc[0], ndc[1], 0.5).unproject(camera).sub(camera.position).normalize();
      sky.uniforms.uSunDir.value.copy(dir);
      light.position.copy(dir).multiplyScalar(40);
    },
    // Back to the live planet. With keepSeat the traveler stays seated on the bench at true size
    // (backpack set down beside it) and everything else returns to normal; release() stands them up.
    leave({ keepSeat = false } = {}) {
      if (!saved || held) return;
      hidden().forEach((o, i) => { o.visible = saved.visible[i]; });
      ironMats.forEach((m, i) => { [m.metalness, m.roughness] = ironSaved[i]; });
      sky.fragmentShader = SKY_SHADER;
      sky.needsUpdate = true;
      sky.uniforms.uSunDir.value.copy(saved.sun);
      light.position.copy(saved.light);
      bench.scale.setScalar(1);
      T.group.scale.setScalar(1);
      clear = 0;
      lockFocus = keepSeat ? "planet" : false;
      held = true;
      if (!keepSeat) this.release();
    },
    // Hand the tilt-shift band back to the page (used once the first cut has settled).
    unlockFocus() {
      lockFocus = false;
    },
    release() {
      if (!saved) return;
      T.pack.visible = true;
      T.arms[1].children.forEach(c => { c.visible = true; });
      T.legs.forEach(l => { l.rotation.z = 0; });
      T.arms.forEach(a => { a.rotation.z = 0; });
      pack.visible = false;
      world.render = render;
      lockFocus = false;
      held = false;
      saved = null;
    },
    // Behind the bench, looking over it toward the way it faces, far enough back to show the curve.
    shot(desired, { elevation = 9, lookUp = 0.8, view = 12 } = {}) {
      const od = world.objects.bench.dir;
      const fwd = new V(0, 0, 1).applyQuaternion(bench.quaternion);
      const back = fwd.addScaledVector(od, -fwd.dot(od)).normalize().negate();
      const e = elevation * Math.PI / 180;
      desired.dir.copy(od).multiplyScalar(Math.sin(e)).addScaledVector(back, Math.cos(e)).normalize();
      desired.look.copy(od).multiplyScalar(6 + lookUp);
      desired.up.copy(od);
      desired.view = view;
    }
  };
})();
