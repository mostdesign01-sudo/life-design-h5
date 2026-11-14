import * as THREE from "three";
import { createPost, softTexture } from "./look.js";
import {
  R, Y, Z, SUN, POLE, TERMINATOR, PATH_ANGLE, shared,
  dirAt, surfaceRadius, placeOnPlanet, yawToward, rng, randomDir
} from "./geo.js";
import { buildSky, buildCloudSea, buildMotes } from "./sky.js";
import {
  buildPlanet, buildAtmosphere, buildGrass, scatter, flowerGeometry, mossyRockGeometry
} from "./ground.js";
import {
  buildTree, buildBush, buildSpring, buildWorkshop, buildLanterns,
  buildBench, buildVine, buildSignpost, buildTraveler, buildFarPlanets
} from "./props.js";

export { R, SUN, POLE, surfaceRadius, buildTraveler };

const SOFT = softTexture();

export function createWorld(canvas) {
  const mobile = window.innerWidth < 700 || matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2);
  let resolutionScale = 1;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf0e2d4, 55, 140);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

  const rand = rng(612);
  const { sky, setMood } = buildSky(renderer);
  scene.add(sky);

  // Image-based lighting: bake the sky into a PMREM env map so every standard material
  // (especially the water) finally has something to reflect, and dark sides pick up skylight.
  // The clone shares the sky's material, so mood changes propagate before each rebake.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  let envPlay = -1;
  let envAt = -1e9;
  function bakeEnv(play, time) {
    if (scene.environment) scene.environment.dispose();
    scene.environment = pmrem.fromScene(envScene, 0.05, 1, 400).texture;
    envPlay = play;
    envAt = time;
  }

  const clouds = buildCloudSea(rand);
  scene.add(clouds.group);

  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6b8a4e, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b5, 2.35);
  sun.position.copy(SUN).multiplyScalar(28);
  sun.castShadow = true;
  const shadowSize = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  const shadowExtent = R + 1.9;
  sc.left = sc.bottom = -shadowExtent;
  sc.right = sc.top = shadowExtent;
  sc.near = 8;
  sc.far = 48;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 6;
  sun.shadow.blurSamples = 12;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xc4d2ff, 0.28);
  fill.position.copy(SUN).multiplyScalar(-1).add(Y.clone().multiplyScalar(1.2)).multiplyScalar(18);
  scene.add(fill);

  const spring = buildSpring(rand);
  const workshop = buildWorkshop();
  const lanterns = buildLanterns();
  const bench = buildBench();
  const vine = buildVine(rand);
  const sign = buildSignpost();

  const benchDir = TERMINATOR.clone().multiplyScalar(0.97).add(SUN.clone().multiplyScalar(0.26)).normalize();
  const layout = {
    spring: { dir: dirAt(34, 120), radius: 1.15 / R, labelHeight: 0.7, focus: 1.1, parts: [spring.group] },
    workshop: { dir: dirAt(40, 190), radius: 0.85 / R, labelHeight: 1.55, focus: 1.3, parts: [workshop.group] },
    bench: { dir: benchDir, radius: 0.55 / R, labelHeight: 1.0, focus: 0.85, parts: [bench.group] },
    lanterns: { dir: dirAt(32, 52), radius: 0.9 / R, labelHeight: 1.25, focus: 1.05, parts: [lanterns.group] },
    vine: { dir: dirAt(40, 255), radius: 0.6 / R, labelHeight: 1.1, focus: 1.2, parts: [vine.group] },
    sign: { dir: dirAt(20, 305), radius: 0.25 / R, labelHeight: 1.45, focus: 0.9, parts: [sign.group] }
  };

  // Dirt aprons under each stop so the props sit in worn soil rather than floating on grass.
  const aprons = Object.values(layout).map(item =>
    new THREE.Vector4(item.dir.x, item.dir.y, item.dir.z, item.radius * 1.35)
  );
  while (aprons.length < 6) aprons.push(new THREE.Vector4(0, 1, 0, 0));

  const planet = buildPlanet(aprons);
  scene.add(planet.mesh);
  const atmosphere = buildAtmosphere();
  scene.add(atmosphere.mesh);

  placeOnPlanet(spring.group, layout.spring.dir, 0, -0.03);
  placeOnPlanet(workshop.group, layout.workshop.dir, yawToward(layout.workshop.dir, POLE), -0.03);
  placeOnPlanet(lanterns.group, layout.lanterns.dir, yawToward(layout.lanterns.dir, POLE), -0.02);
  placeOnPlanet(bench.group, benchDir, yawToward(benchDir, SUN), -0.02);
  placeOnPlanet(vine.group, layout.vine.dir, yawToward(layout.vine.dir, POLE), -0.03);
  placeOnPlanet(sign.group, layout.sign.dir, yawToward(layout.sign.dir, POLE) + 0.6, -0.02);
  [spring.group, workshop.group, lanterns.group, bench.group, vine.group, sign.group].forEach(g => scene.add(g));

  const pops = [];
  let clockTime = 0;
  function popIn(obj, delay, from = 0) {
    pops.push({ obj, base: obj.scale.clone(), start: delay, kind: "in", from });
    obj.scale.copy(obj.scale).multiplyScalar(Math.max(from, 0.0001));
  }
  function squash(obj, amount = 0.22) {
    for (let i = pops.length - 1; i >= 0; i -= 1) if (pops[i].obj === obj && pops[i].kind === "squash") pops.splice(i, 1);
    pops.push({ obj, base: obj.userData.baseScale || obj.scale.clone(), start: clockTime, kind: "squash", amount });
  }
  [spring.group, workshop.group, lanterns.group, bench.group, vine.group, sign.group].forEach((g, i) => {
    g.userData.baseScale = g.scale.clone();
    popIn(g, 0.05 + i * 0.06, 0.6);
  });

  layout.workshop.front = Z.clone().applyQuaternion(workshop.group.quaternion);
  layout.lanterns.front = Z.clone().applyQuaternion(lanterns.group.quaternion);

  const blockers = Object.values(layout).map(item => ({ dir: item.dir, radius: item.radius }));

  const trees = [];
  const treeSpots = [[58, 20, 1.1], [62, 95, 0.95], [55, 150, 1.2], [64, 225, 1.0], [58, 285, 1.15], [70, 330, 0.9], [100, 60, 1.3], [105, 200, 1.25], [120, 300, 1.2], [140, 120, 1.3], [150, 250, 1.1]];
  treeSpots.forEach(([a, b, s]) => {
    const dir = dirAt(a, b);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.18)) return;
    const tree = buildTree(rand, s);
    placeOnPlanet(tree.group, dir, rand() * 6, -0.04);
    scene.add(tree.group);
    popIn(tree.group, 0.15 + trees.length * 0.05);
    trees.push(tree);
    blockers.push({ dir, radius: (0.22 * s) / R });
  });
  const bushes = [];
  for (let i = 0; i < 26; i += 1) {
    const dir = randomDir(rand);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.12)) continue;
    if (Math.abs(dir.angleTo(POLE) - PATH_ANGLE) < 0.07) continue;
    const bush = buildBush(rand, 0.8 + rand() * 0.7);
    placeOnPlanet(bush, dir, rand() * 6, -0.02);
    scene.add(bush);
    bushes.push(bush);
  }

  const grass = buildGrass(rand, blockers, { count: mobile ? 4500 : 9500, aprons });
  grass.meshes.forEach(mesh => scene.add(mesh));

  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  const flowers = scatter(rand, 680, blockers, flowerGeometry(), flowerMat, { avoidPath: true, tilt: 0.3 });
  const flowerPalette = [0xffffff, 0xfff1a8, 0xffb7cc, 0xd6c2ff, 0xffd27a].map(c => new THREE.Color(c));
  for (let i = 0; i < flowers.max; i += 1) flowers.mesh.setColorAt(i, flowerPalette[Math.floor(rand() * flowerPalette.length)]);
  scene.add(flowers.mesh);

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const rocks = scatter(rand, 70, blockers, mossyRockGeometry(), rockMat, { scaleMin: 0.5, scaleMax: 1.8, tilt: 0.4 });
  rocks.mesh.castShadow = true;
  rocks.mesh.receiveShadow = true;
  scene.add(rocks.mesh);

  const fireflies = buildMotes(rand, { count: 70, color: 0xfff09a, size: 26, minLift: 0.25, maxLift: 1.4, speed: 0.5, opacity: 0.9 });
  const fluff = buildMotes(rand, { count: 40, color: 0xffffff, size: 18, minLift: 0.6, maxLift: 3.2, speed: 0.25, opacity: 0.45 });
  scene.add(fireflies, fluff);

  const dust = Array.from({ length: 14 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xe6d2ad, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, age: 0, up: new THREE.Vector3() };
  });
  let dustIndex = 0;
  function kickDust(position, up) {
    const d = dust[dustIndex];
    dustIndex = (dustIndex + 1) % dust.length;
    d.sprite.position.copy(position).addScaledVector(up, 0.05);
    d.up.copy(up);
    d.age = 0;
    d.sprite.visible = true;
  }

  const farPlanets = buildFarPlanets(rand);
  farPlanets.forEach(p => scene.add(p.group));

  const objects = {};
  Object.entries(layout).forEach(([id, item]) => {
    const hit = [];
    item.parts.forEach(part => part.traverse(node => { if (node.isMesh && !node.userData.noShadow) hit.push(node); }));
    objects[id] = { id, ...item, hit, reach: item.radius + 0.1 };
  });

  const post = createPost(renderer, scene);
  let tiltShift = true;
  let qualityLevel = 2;

  const current = { health: 0.5, work: 0.5, play: 0.5, love: 0.5, gravity: 0, designable: 0, problem: 0 };
  const target = { ...current };
  const velocity = { health: 0, work: 0, play: 0, love: 0 };
  const windowCalm = new THREE.Color(0xffb455);
  const windowHot = new THREE.Color(0xff2a00);
  const smokeDark = new THREE.Color(0x3b3742);
  const smokeLight = new THREE.Color(0xfff6f0);
  const fogTint = new THREE.Color(0xf3e3d6);
  const cloudVivid = new THREE.Color(0xffffff);
  const cloudDull = new THREE.Color(0xb8bcc9);
  const bulbOn = new THREE.Color(0xffc861);
  const bulbOff = new THREE.Color(0x000000);
  const lanternA = new THREE.Vector3();
  const lanternB = new THREE.Vector3();
  const smokeMat4 = new THREE.Matrix4();
  const smokePos = new THREE.Vector3();
  const smokeQuat = new THREE.Quaternion();
  const smokeScale = new THREE.Vector3();
  const smokeEuler = new THREE.Euler();
  const spinQuat = new THREE.Quaternion();

  function setTargets(next) {
    Object.assign(target, next);
  }

  function snap() {
    Object.assign(current, target);
    Object.keys(velocity).forEach(key => { velocity[key] = 0; });
  }

  const fx = { glint: -10, orb: -10, bulbs: -10, gem: -10, flash: -10, sprout: -10 };
  const bumpAt = (start, duration) => {
    const t = (clockTime - start) / duration;
    return t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
  };

  function celebrate(id) {
    const group = { spring: spring.group, workshop: workshop.group, lanterns: lanterns.group, bench: bench.group, vine: vine.group, sign: sign.group }[id];
    if (group) squash(group);
    if (id === "spring") fx.glint = clockTime;
    else if (id === "workshop") {
      fx.flash = clockTime;
      workshop.spawn += 6;
    } else if (id === "lanterns") fx.bulbs = clockTime;
    else if (id === "vine") fx.sprout = clockTime;
    else if (id === "sign") fx.gem = clockTime;
  }

  let diaryReady = false;
  function setDiaryReady(ready) {
    diaryReady = ready;
  }

  let cull = null;
  const cullTmp = new THREE.Vector3();
  function setNearCull(dir, look) {
    cull = dir ? { dir, look } : null;
  }

  function applyHealth(h) {
    shared.uHealth.value = h;
    flowers.mesh.count = Math.round(flowers.max * (0.12 + 0.88 * h));
  }

  function updateWorkshop(v, dt, time) {
    const w = current.work;
    v.windowMat.emissive.copy(windowCalm).lerp(windowHot, THREE.MathUtils.clamp((1 - w) * 1.4 - 0.2, 0, 1));
    v.windowMat.emissiveIntensity = 0.9 + Math.sin(time * 9) * 0.3 * (1 - w);
    const rate = 1.5 + (1 - w) * 12;
    v.spawn += dt * rate;
    const smoke = v.smoke;
    const alphas = smoke.mesh.geometry.getAttribute("aAlpha");
    while (v.spawn >= 1) {
      v.spawn -= 1;
      let slot = -1;
      for (let i = 0; i < smoke.max; i += 1) {
        if (smoke.ages[i] < 0 || smoke.ages[i] >= smoke.lives[i]) { slot = i; break; }
      }
      if (slot < 0 && smoke.mesh.count < smoke.max) slot = smoke.mesh.count;
      if (slot < 0) break;
      smoke.ages[slot] = 0;
      smoke.lives[slot] = 2.2 + Math.random() * 1.6;
      smoke.drifts[slot * 2] = (Math.random() - 0.5) * 0.25;
      smoke.drifts[slot * 2 + 1] = (Math.random() - 0.5) * 0.25;
      smoke.spins[slot] = (Math.random() - 0.5) * 1.2;
      smoke.sizes[slot] = 0.72 + Math.random() * 0.55;
      smokePos.copy(v.emit);
      // A little scatter at the mouth of the chimney so puffs never line up into a chain.
      smokePos.x += (Math.random() - 0.5) * 0.12;
      smokePos.y += Math.random() * 0.1;
      smokePos.z += (Math.random() - 0.5) * 0.12;
      smokeQuat.setFromEuler(smokeEuler.set(
        (Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5
      ));
      smokeScale.setScalar(0.7);
      smokeMat4.compose(smokePos, smokeQuat, smokeScale);
      smoke.mesh.setMatrixAt(slot, smokeMat4);
      alphas.setX(slot, 0.6);
      smoke.mesh.count = Math.max(smoke.mesh.count, slot + 1);
    }
    for (let i = 0; i < smoke.mesh.count; i += 1) {
      if (!(smoke.lives[i] > 0) || smoke.ages[i] >= smoke.lives[i]) {
        alphas.setX(i, 0);
        continue;
      }
      smoke.ages[i] += dt;
      const k = smoke.ages[i] / smoke.lives[i];
      if (k >= 1) {
        alphas.setX(i, 0);
        continue;
      }
      smoke.mesh.getMatrixAt(i, smokeMat4);
      smokeMat4.decompose(smokePos, smokeQuat, smokeScale);
      smokePos.y += dt * (0.35 + (1 - w) * 0.25);
      smokePos.x += smoke.drifts[i * 2] * dt;
      smokePos.z += smoke.drifts[i * 2 + 1] * dt;
      const size = smoke.sizes[i] * (0.75 + (1.7 + (1 - w) * 1.9) * Math.pow(k, 0.55));
      smokeScale.set(size, size, size);
      // Every puff slowly turns on its own axis so facets never line up across instances.
      spinQuat.setFromAxisAngle(Y, smoke.spins[i] * dt);
      smokeQuat.multiply(spinQuat);
      smokeMat4.compose(smokePos, smokeQuat, smokeScale);
      smoke.mesh.setMatrixAt(i, smokeMat4);
      const shade = THREE.MathUtils.smoothstep(1 - w, 0.25, 0.8);
      smoke.mesh.material.color.copy(smokeLight).lerp(smokeDark, shade);
      // Ease in, hold, ease out — no mid-life brightness spike like the old sine curve.
      alphas.setX(i, THREE.MathUtils.smoothstep(k, 0, 0.12)
        * (1 - THREE.MathUtils.smoothstep(k, 0.55, 1)) * (0.42 + (1 - w) * 0.3));
    }
    smoke.mesh.instanceMatrix.needsUpdate = true;
    alphas.needsUpdate = true;
  }

  function update(dt, time) {
    shared.uTime.value = time;
    clockTime = time;
    const k = 1 - Math.exp(-dt * 2.5);
    Object.keys(current).forEach(key => {
      if (key in velocity) {
        velocity[key] += ((target[key] - current[key]) * 45 - velocity[key] * 7.5) * dt;
        current[key] = THREE.MathUtils.clamp(current[key] + velocity[key] * dt, -0.05, 1.05);
      } else {
        current[key] += (target[key] - current[key]) * k;
      }
    });

    pops.forEach(p => {
      const t = time - p.start;
      if (t < 0) return;
      if (p.kind === "in") {
        const u = Math.min(1, t / 0.55);
        const c = 2.2;
        const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
        p.obj.scale.copy(p.base).multiplyScalar(p.from + (1 - p.from) * e);
        if (u >= 1) p.done = true;
      } else {
        const sy = 1 - p.amount * Math.sin(t * 14) * Math.exp(-t * 5);
        const sxz = 1 / Math.sqrt(sy);
        p.obj.scale.set(p.base.x * sxz, p.base.y * sy, p.base.z * sxz);
        if (t > 1.2) {
          p.obj.scale.copy(p.base);
          p.done = true;
        }
      }
    });
    for (let i = pops.length - 1; i >= 0; i -= 1) if (pops[i].done) pops.splice(i, 1);

    applyHealth(THREE.MathUtils.clamp(current.health, 0, 1));
    const burst = bumpAt(fx.glint, 1.2);
    if (spring.waterMat.userData.uBurst) spring.waterMat.userData.uBurst.value = burst;

    updateWorkshop(workshop, dt, time);

    const love = current.love;
    lanterns.posts.forEach((p, i) => {
      p.rotation.z = (i === 0 ? -1 : 1) * (love * 0.3 - 0.12);
      lanterns.glassMats[i].emissiveIntensity = 0.15 + love * 2.2 + Math.sin(time * 2 + i) * 0.08;
      lanterns.halos[i].material.opacity = 0.1 + love * 0.6;
      lanterns.halos[i].scale.setScalar(0.3 + love * 0.4);
    });
    lanterns.posts[0].updateMatrix();
    lanterns.posts[1].updateMatrix();
    lanternA.set(0.16, 0.78, 0).applyMatrix4(lanterns.posts[0].matrix);
    lanternB.set(-0.16, 0.78, 0).applyMatrix4(lanterns.posts[1].matrix);
    const lit = Math.round(THREE.MathUtils.clamp(target.love, 0, 1) * lanterns.bulbs.length);
    lanterns.bulbs.forEach((bulb, i) => {
      const t = (i + 1) / (lanterns.bulbs.length + 1);
      bulb.position.lerpVectors(lanternA, lanternB, t);
      bulb.position.y -= Math.sin(t * Math.PI) * (0.1 + (1 - love) * 0.14);
      const fromEdge = Math.min(i, lanterns.bulbs.length - 1 - i);
      const rank = fromEdge * 2 + (i < lanterns.bulbs.length / 2 ? 0 : 1);
      const on = rank < lit ? 1 : 0;
      bulb.material.color.set(on ? 0xffd27a : 0x5e5866);
      bulb.material.emissive.copy(bulbOff).lerp(bulbOn, on);
      bulb.material.emissiveIntensity = 0.7;
      bulb.scale.setScalar(1 + bumpAt(fx.bulbs + fromEdge * 0.09, 0.35) * 0.9 * on);
    });

    const play = current.play;
    const mood = setMood(play, time);
    // Rebake the env map only when the mood actually moved: a few times per session, not per frame.
    if (envPlay < 0 || (Math.abs(play - envPlay) > 0.04 && time - envAt > 400)) bakeEnv(play, time);
    shared.uHaze.value.copy(mood.skyLight).lerp(fogTint, 0.35);
    shared.uSunTint.value.copy(mood.light);
    hemi.color.copy(mood.skyLight);
    hemi.groundColor.copy(mood.groundLight);
    hemi.intensity = mood.ambient;
    sun.color.copy(mood.light);
    sun.intensity = mood.lightPower;
    scene.fog.color.copy(shared.uHaze.value);
    clouds.materials.forEach(m => m.color.copy(cloudDull).lerp(cloudVivid, mood.vivid));
    atmosphere.material.uniforms.uStrength.value = 0.28 + mood.vivid * 0.18;

    const knotScale = current.problem < 0.5 ? 0.45 : 0.4 + current.gravity * 1.2;
    vine.knot.scale.setScalar(knotScale);
    vine.sprout.visible = current.problem > 0.5;
    vine.sprout.scale.setScalar((0.6 + current.designable * 1.6) * (1 + bumpAt(fx.sprout + 0.4, 0.6) * 0.6));
    vine.glowMat.emissiveIntensity = 0.6 + Math.sin(time * 2.4) * 0.35;

    sign.gem.material.emissiveIntensity = (diaryReady ? 1.8 : 0.15) + bumpAt(fx.gem, 1) * 2;
    sign.halo.visible = diaryReady;
    workshop.windowMat.emissiveIntensity += bumpAt(fx.flash, 0.5) * 1.5;

    trees.forEach(tree => {
      tree.crown.rotation.z = Math.sin(time * 0.9 + tree.phase) * 0.025;
      tree.crown.rotation.x = Math.sin(time * 0.7 + tree.phase * 1.3) * 0.02;
      tree.group.visible = !cull || cullTmp.copy(tree.group.position).sub(cull.look).dot(cull.dir) < 1.2;
    });
    bushes.forEach(bush => {
      bush.visible = !cull || cullTmp.copy(bush.position).sub(cull.look).dot(cull.dir) < 1.2;
    });
    fireflies.material.uniforms.uTime.value = time;
    fluff.material.uniforms.uTime.value = time;
    dust.forEach(d => {
      if (!d.sprite.visible) return;
      d.age += dt;
      const t = d.age / 0.7;
      if (t >= 1) {
        d.sprite.visible = false;
        return;
      }
      d.sprite.position.addScaledVector(d.up, dt * 0.25);
      d.sprite.scale.setScalar(0.12 + t * 0.25);
      d.sprite.material.opacity = (1 - t) * 0.5;
    });

    clouds.group.rotation.y = time * 0.004;
    farPlanets.forEach(p => {
      p.group.position.y = p.pos[1] + Math.sin(time * 0.4 + p.phase) * 0.6;
      p.group.rotation.y = time * 0.08 + p.phase;
    });
  }

  function setSize(w, h) {
    const pr = pixelRatio * resolutionScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    [fireflies, fluff].forEach(m => { m.material.uniforms.uPixelRatio.value = pr * (h / 800); });
  }

  function setQuality(level) {
    qualityLevel = level;
    tiltShift = level >= 2;
    post.setTiltShift(tiltShift);
    post.setBloom(level >= 1);
    post.setSamples(level >= 1 ? 4 : 0);
    if (level < 2) pixelRatio = Math.min(pixelRatio, 1.25);
    if (level < 1) {
      pixelRatio = 1;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    grass.setCount(level >= 2 ? 1 : level >= 1 ? 0.7 : 0.45);
    setSize(window.innerWidth, window.innerHeight);
  }

  // Remember ratios that still dropped frames so we do not climb back into them.
  const failedScales = new Set();
  let frameBudget = 0;
  function setResolutionScale(scale) {
    const next = THREE.MathUtils.clamp(scale, 0.55, 1);
    if (Math.abs(next - resolutionScale) < 0.02) return;
    resolutionScale = next;
    setSize(window.innerWidth, window.innerHeight);
  }
  function noteFrameTime(ms) {
    if (qualityLevel < 1) return;
    frameBudget = frameBudget * 0.85 + ms * 0.15;
    if (frameBudget > 22) {
      failedScales.add(Math.round(resolutionScale * 20) / 20);
      setResolutionScale(resolutionScale * 0.85);
      frameBudget = 16;
    } else if (frameBudget < 12) {
      const up = Math.min(1, resolutionScale * 1.05);
      if (!failedScales.has(Math.round(up * 20) / 20)) setResolutionScale(up);
    }
  }

  function render(cam, time) {
    sky.position.copy(cam.position);
    post.render(cam, time);
  }

  function snapshot(cam, size) {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    post.setSize(size, size, 1);
    post.setTiltShift(false);
    clouds.group.visible = false;
    sky.position.copy(cam.position);
    const fog = scene.fog;
    scene.fog = null;
    post.render(cam, 0);
    scene.fog = fog;
    clouds.group.visible = true;
    post.setTiltShift(tiltShift);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    out.getContext("2d").drawImage(renderer.domElement, 0, 0, size, size);
    setSize(window.innerWidth, window.innerHeight);
    return out;
  }

  // See-through window around the traveler (screen-space). Main.js writes this each frame.
  function setSeeThrough(cx, cy, radius, viewDepth) {
    shared.uHole.value.set(cx, cy, radius, viewDepth);
  }

  return {
    renderer, scene, camera, sky, clouds: clouds.group, trees: trees.map(t => t.group), bushes, objects, farPlanets, blockers,
    setTargets, snap, update, render, setSize, setQuality, snapshot, kickDust, celebrate, setDiaryReady, setNearCull,
    setFocus: post.setFocus, setSeeThrough, noteFrameTime, get resolutionScale() { return resolutionScale; }
  };
}
