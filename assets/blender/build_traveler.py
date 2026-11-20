"""Build the 小旅人 model in Blender and export it for the planet.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python build_traveler.py

Conventions, chosen so the export drops straight into planet/props.js:
  - Z up, feet on z = 0, facing -Y (the glTF exporter turns that into +Z / Y-up in three.js).
  - 1 Blender unit = 1 three.js unit, so the traveler stands 1.33 tall next to R = 4.4.
  - Colours are the palette from character/小旅人-角色设定图.png, converted to linear.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SHEET = os.path.join(ROOT, "..", "life-design-h5", "character", "小旅人-角色设定图.png")
OUT_BLEND = os.path.join(HERE, "traveler.blend")
OUT_GLB = os.path.join(HERE, "exports", "traveler.glb")
RENDER_DIR = os.environ.get("RENDER_DIR", "/tmp/model-render")

# ---------------------------------------------------------------- helpers

def srgb(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hexcode, a=1.0):
    h = hexcode.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb(r), srgb(g), srgb(b), a)


MATS = {}


def mat(name, hexcode, rough=0.85, metal=0.0, emit=None, emit_strength=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(hexcode)
    m.diffuse_color = rgba(hexcode)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = rgba(emit)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    MATS[name] = m
    return m


PARTS = []


def finish(obj, name, material, smooth=True, parent=None):
    obj.name = name
    obj.data.name = name
    if material:
        obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    if parent:
        obj.parent = parent
    PARTS.append(obj)
    return obj


def sphere(name, loc, r, scale=(1, 1, 1), seg=32, ring=16, material=None, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    o.rotation_euler = rot
    return finish(o, name, material, True, parent)


def dome(name, loc, r, cut=-0.05, scale=(1, 1, 1), seg=32, ring=20, material=None, parent=None):
    """Upper part of a sphere: the beanie, the hair under it."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=r, location=(0, 0, 0))
    o = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut * r], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    o.location = loc
    o.scale = scale
    o.data.update()
    return finish(o, name, material, True, parent)


def cyl(name, loc, r1, r2, h, verts=24, material=None, parent=None, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=(0, 0, 0))
    o = bpy.context.object
    o.rotation_euler = rot
    o.location = loc
    return finish(o, name, material, smooth, parent)


def box(name, loc, size, bevel=0.02, seg=3, material=None, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.object
    o.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        bev = o.modifiers.new("bev", "BEVEL")
        bev.width = bevel
        bev.segments = seg
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(40)
        bpy.ops.object.modifier_apply(modifier=bev.name)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, name, material, True, parent)


def torus(name, loc, R, r, material=None, parent=None, rot=(0, 0, 0), scale=(1, 1, 1), maj=32, minr=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=maj,
                                     minor_segments=minr, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = scale
    return finish(o, name, material, True, parent)


def poly_curve(name, points, radius, material=None, parent=None, closed=False):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY" if len(points) <= 4 else "BEZIER")
    if sp.type == "POLY":
        sp.points.add(len(points) - 1)
        for i, p in enumerate(points):
            sp.points[i].co = (p[0], p[1], p[2], 1)
    else:
        sp.bezier_points.add(len(points) - 1)
        for i, p in enumerate(points):
            bp = sp.bezier_points[i]
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = "AUTO"
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    return finish(o, name, material, True, parent)


def arc(name, cx, cy, cz, radius, a0, a1, width, material, parent=None, steps=20, flip=False):
    pts = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx + radius * math.cos(a), cy, cz + (1 if flip else -1) * radius * math.sin(a) * 0.55))
    return poly_curve(name, pts, width, material, parent)


# ---------------------------------------------------------------- scene reset

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

root = bpy.data.objects.new("Traveler", None)
root.empty_display_size = 0.2
bpy.context.collection.objects.link(root)

# palette read off the character sheet
SKIN = mat("Skin", "#F5D3B6", 1.0)
SKIN_SHADE = mat("SkinShade", "#E3B697", 1.0)
JACKET = mat("Jacket", "#D2734F", 1.0)
JACKET_DARK = mat("JacketDark", "#B0583C", 1.0)
CREAM = mat("Cream", "#F8EED7", 1.0)
BEANIE = mat("Beanie", "#4E9C99", 1.0)
BEANIE_DARK = mat("BeanieDark", "#3E8583", 1.0)
PANTS = mat("Pants", "#4A5A64", 1.0)
BOOT = mat("Boot", "#6E4B2F", 1.0)
BOOT_SOLE = mat("BootSole", "#4B362F", 1.0)
CANVAS = mat("Canvas", "#B4A887", 1.0)
CANVAS_DARK = mat("CanvasDark", "#8E8467", 1.0)
BEDROLL = mat("Bedroll", "#B0483B", 1.0)
WOOD = mat("Wood", "#7A5634", 1.0)
INK = mat("Ink", "#3B2A20", 0.75)
INK_COLOR = "#4B362F"
BLUSH = mat("Blush", "#EDA48F", 1.0)
METAL = mat("LampMetal", "#6E6255", 0.45, 0.6)
GLOW = mat("LampGlow", "#FFE6A8", 0.4, 0.0, emit="#FFC35A", emit_strength=12.0)

# Everything here is flat-shaded cloth: kill the plastic specular so the preview reads like the
# illustration rather than like a toy.
for m in MATS.values():
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf and "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.15 if m.name != "LampMetal" else 0.6

# ---------------------------------------------------------------- legs and boots
# 2.5 heads: short thick legs, boots as big as a fist.
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    cyl("Leg" + tag, (side * 0.090, 0, 0.215), 0.076, 0.068, 0.21, 20, PANTS, root)
    cyl("BootShaft" + tag, (side * 0.090, 0, 0.120), 0.079, 0.076, 0.10, 20, BOOT, root)
    torus("BootCuff" + tag, (side * 0.090, 0, 0.170), 0.079, 0.017, BOOT, root)
    # rounded toe that tips up, so the boot reads as heavy leather rather than as a box
    sphere("BootToe" + tag, (side * 0.090, -0.055, 0.073), 0.081, (1.0, 1.24, 0.80), 24, 14, BOOT, root)
    box("BootSole" + tag, (side * 0.090, -0.026, 0.026), (0.176, 0.246, 0.044), 0.019, 3, BOOT_SOLE, root)
    torus("BootSeam" + tag, (side * 0.090, -0.02, 0.140), 0.080, 0.005, BOOT_SOLE, root, scale=(1, 1.1, 1))

# ---------------------------------------------------------------- jacket
box("Jacket", (0, 0, 0.532), (0.375, 0.285, 0.395), 0.075, 6, JACKET, root)
torus("Hem", (0, 0, 0.345), 0.179, 0.026, JACKET_DARK, root, scale=(1, 0.9, 1))
torus("Collar", (0, 0, 0.712), 0.143, 0.031, JACKET_DARK, root, scale=(1, 0.9, 1))
box("Zip", (0, -0.152, 0.545), (0.020, 0.013, 0.325), 0.005, 2, CREAM, root)
sphere("ZipPull", (0, -0.159, 0.706), 0.018, (1, 0.55, 1.35), 14, 10, JACKET_DARK, root)
torus("ZipRing", (0, -0.158, 0.682), 0.015, 0.005, JACKET_DARK, root, rot=(math.pi / 2, 0, 0), maj=14, minr=6)
# slanted hand pockets and a pinch of fabric under each arm, the only folds the sheet gives
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    box("Pocket" + tag, (side * 0.104, -0.150, 0.452), (0.098, 0.016, 0.026), 0.006, 2, JACKET_DARK, root,
        rot=(0, side * 0.38, 0))
    box("PocketLip" + tag, (side * 0.104, -0.156, 0.470), (0.104, 0.012, 0.016), 0.005, 2, JACKET, root,
        rot=(0, side * 0.38, 0))

# ---------------------------------------------------------------- arms
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    grip = side > 0
    sphere("Shoulder" + tag, (side * 0.190, 0, 0.664), 0.070, (1, 0.95, 0.95), 22, 14, JACKET, root)
    cyl("Arm" + tag, (side * 0.198, -0.012 if grip else 0, 0.552), 0.060, 0.051, 0.235, 20, JACKET, root,
        rot=(-0.14 if grip else 0, side * -0.10, 0))
    for k, wz in enumerate((0.60, 0.52)):
        torus("SleeveFold%s%d" % (tag, k), (side * (0.196 + 0.004 * k), -0.008 if grip else 0, wz),
              0.058 - 0.002 * k, 0.007, JACKET_DARK, root, rot=(0.05, side * -0.1, 0))
    torus("Cuff" + tag, (side * 0.212, -0.03 if grip else 0, 0.442), 0.050, 0.017, JACKET_DARK, root)
    sphere("Hand" + tag, (0.233 if grip else side * 0.206, -0.052 if grip else -0.004,
                          0.433 if grip else 0.408),
           0.052 if grip else 0.046, (1.0, 1.05, 0.98), 24, 16, SKIN, root)

# a thumb over the staff, so the hand reads as gripping rather than touching
sphere("ThumbR", (0.241, -0.071, 0.452), 0.027, (1.05, 1.0, 1.3), 16, 12, SKIN, root)
sphere("ThumbL", (-0.196, -0.028, 0.420), 0.022, (1.0, 1.0, 1.3), 16, 12, SKIN, root)

# ---------------------------------------------------------------- head
HEAD_R = 0.258
HEAD_Z = 0.952
sphere("Head", (0, 0, HEAD_Z), HEAD_R, (1.0, 0.99, 1.02), 48, 28, SKIN, root)
for side in (-1, 1):
    sphere("Ear" + ("L" if side < 0 else "R"), (side * 0.250, 0.014, HEAD_Z - 0.012), 0.046,
           (0.5, 0.85, 1.0), 16, 12, SKIN, root)


def on_face(x, dz, out=0.0):
    """Y of the head surface at (x, HEAD_Z + dz), pushed `out` towards the viewer (-Y)."""
    depth = HEAD_R * HEAD_R - x * x - dz * dz
    return -math.sqrt(max(depth, 0.0)) + out


def face_arc(name, cx, cz, radius, a0, a1, width, material, steps=18, flip=False, out=0.007):
    """A line drawn *on* the head: every point sits on the surface, so the ends do not sink in."""
    pts = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x = cx + radius * math.cos(a)
        dz = cz + (1 if flip else -1) * radius * math.sin(a) * 0.55
        pts.append((x, on_face(x, dz, out), HEAD_Z + dz))
    return poly_curve(name, pts, width, material, root)


# The sheet's resting face: two solid black dots, a small upward smile, soft oval blush, and brows
# that sit a little low so the character reads calm rather than startled.
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    ex, ez = side * 0.098, -0.040
    sphere("Eye" + tag, (ex, on_face(ex, ez, 0.006), HEAD_Z + ez), 0.037, (1, 0.55, 1.02), 26, 18, INK, root)
    face_arc("Brow" + tag, side * 0.101, 0.022, 0.038, 218, 322, 0.0070, INK, steps=16)
    cx, cz = side * 0.154, -0.090
    sphere("Cheek" + tag, (cx, on_face(cx, cz, 0.004), HEAD_Z + cz), 0.052, (1, 0.20, 0.56), 20, 14, BLUSH, root)
# flip=True puts the low point in the middle: a smile, not a frown
face_arc("Mouth", 0.0, -0.150, 0.030, 208, 332, 0.0070, INK, steps=18, flip=True)
sphere("Nose", (0, on_face(0, -0.090, 0.010), HEAD_Z - 0.090), 0.013, (1, 0.8, 0.9), 14, 10, SKIN_SHADE, root)

# ---------------------------------------------------------------- hair
# A dark band under the cap, with a soft fringe over the forehead and short sideburns in front of
# the ears: the sheet shows hair as a shape that frames the face, not as a cap of its own.
dome("Hair", (0, 0.004, HEAD_Z), HEAD_R * 1.014, cut=0.155, seg=44, ring=20, material=INK, parent=root)
for i, (fx, fz, fr) in enumerate(((-0.150, 0.062, 0.032), (-0.080, 0.070, 0.036),
                                  (0.004, 0.064, 0.038), (0.086, 0.070, 0.035), (0.154, 0.064, 0.031))):
    fy = on_face(fx, fz, 0.004)
    sphere("Fringe%d" % i, (fx, fy * 0.99, HEAD_Z + fz), fr, (1.0, 0.72, 0.92), 18, 12, INK, root)
for side in (-1, 1):
    sphere("Sideburn" + ("L" if side < 0 else "R"), (side * 0.243, -0.028, HEAD_Z + 0.012), 0.050,
           (0.45, 0.85, 1.15), 16, 12, INK, root)

# ---------------------------------------------------------------- beanie
dome("Beanie", (0, 0, HEAD_Z + 0.010), HEAD_R * 1.055, cut=0.02, seg=40, ring=20,
     material=BEANIE, parent=root)
# knit: shallow vertical ribs running up the dome
bm = bmesh.new()
bm.from_mesh(bpy.data.objects["Beanie"].data)
for v in bm.verts:
    a = math.atan2(v.co.y, v.co.x)
    v.co *= 1.0 + 0.010 * math.cos(14.0 * a)
bm.to_mesh(bpy.data.objects["Beanie"].data)
bm.free()

# rolled brim, ribbed: waves running around the fold read as cabling
bpy.ops.mesh.primitive_torus_add(major_radius=0.246, minor_radius=0.047, major_segments=144,
                                 minor_segments=18, location=(0, 0, HEAD_Z + 0.124))
brim = bpy.context.object
bm = bmesh.new()
bm.from_mesh(brim.data)
for v in bm.verts:
    rad = math.hypot(v.co.x, v.co.y)
    if rad < 1e-6:
        continue
    a = math.atan2(v.co.y, v.co.x)
    wave = 0.012 * math.cos(14.0 * a)
    v.co.x += math.cos(a) * wave
    v.co.y += math.sin(a) * wave
bm.to_mesh(brim.data)
bm.free()
finish(brim, "BeanieBrim", BEANIE_DARK, True, root)

# pompom: a felted ball with a couple of lobes, not a perfect sphere
sphere("Pompom", (0, 0, HEAD_Z + 0.302), 0.061, (1.02, 1.0, 0.94), 24, 16, CREAM, root)
for i, (dx, dy, dz, dr) in enumerate(((0.052, 0.014, 0.010, 0.036), (-0.054, -0.012, 0.020, 0.034),
                                      (0.010, 0.054, -0.026, 0.033), (-0.014, -0.052, -0.014, 0.031),
                                      (0.02, 0.01, 0.052, 0.030))):
    sphere("PompomLobe%d" % i, (dx, dy, HEAD_Z + 0.302 + dz), dr, (1, 1, 1), 16, 12, CREAM, root)

# ---------------------------------------------------------------- scarf
# Wound tight: three offset coils read as cloth folds; one end hangs flat on the chest, one
# trails off behind the shoulder.
torus("ScarfWrap", (0, 0, 0.752), 0.158, 0.056, CREAM, root, scale=(1, 0.94, 0.80), maj=40, minr=16)
torus("ScarfFold", (0, 0, 0.713), 0.163, 0.046, CREAM, root, scale=(1, 0.92, 0.92), maj=40, minr=14)
torus("ScarfLow", (0, 0, 0.682), 0.158, 0.034, CREAM, root, scale=(1, 0.9, 0.95), maj=36, minr=12)
poly_curve("ScarfTail", [(0.072, -0.142, 0.722), (0.086, -0.163, 0.672), (0.082, -0.176, 0.612),
                         (0.066, -0.174, 0.560)], 0.034, CREAM, root)
poly_curve("ScarfTailEnd", [(0.066, -0.174, 0.566), (0.058, -0.176, 0.540), (0.044, -0.172, 0.524)],
           0.028, CREAM, root)
poly_curve("ScarfTrail", [(-0.070, 0.030, 0.740), (-0.132, 0.072, 0.706), (-0.170, 0.086, 0.664),
                          (-0.186, 0.080, 0.626)], 0.030, CREAM, root)

# ---------------------------------------------------------------- backpack
box("PackBody", (0, 0.216, 0.575), (0.335, 0.215, 0.355), 0.062, 5, CANVAS, root)
box("PackFlap", (0, 0.224, 0.748), (0.343, 0.228, 0.088), 0.032, 4, CANVAS, root)
box("PackPocket", (0, 0.328, 0.500), (0.190, 0.052, 0.140), 0.022, 3, CANVAS_DARK, root)
box("PackBuckle", (0, 0.332, 0.585), (0.040, 0.024, 0.058), 0.008, 2, BOOT_SOLE, root)
box("PackSeam", (0, 0.327, 0.432), (0.196, 0.010, 0.012), 0.004, 2, CANVAS_DARK, root)
cyl("Bedroll", (0, 0.222, 0.840), 0.079, 0.079, 0.40, 24, BEDROLL, root, rot=(0, math.pi / 2, 0))
for x in (-0.128, 0.128):
    torus("BedrollTie%d" % int(x * 1000), (x, 0.222, 0.840), 0.081, 0.011, BOOT_SOLE, root,
          rot=(0, math.pi / 2, 0), maj=22, minr=8)
    box("BedrollStrap%d" % int(x * 1000), (x, 0.222, 0.786), (0.026, 0.040, 0.070), 0.006, 2, BOOT_SOLE, root)
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    # the straps have to sit proud of the jacket, or they vanish inside it
    box("Strap" + tag, (side * 0.101, -0.153, 0.598), (0.052, 0.030, 0.305), 0.013, 3, CANVAS_DARK, root,
        rot=(0.05, 0, 0))
    box("StrapBuckle" + tag, (side * 0.101, -0.171, 0.545), (0.056, 0.018, 0.052), 0.007, 2, BOOT_SOLE, root)
    box("StrapTop" + tag, (side * 0.101, 0.035, 0.778), (0.052, 0.305, 0.030), 0.011, 3, CANVAS_DARK, root)

# lantern on the pack's side, held by a leather loop
lantern = bpy.data.objects.new("Lantern", None)
lantern.empty_display_size = 0.05
bpy.context.collection.objects.link(lantern)
lantern.parent = root
lantern.location = (0.208, 0.242, 0.442)
cyl("LanternTop", (0, 0, 0.050), 0.034, 0.022, 0.034, 16, METAL, lantern)
cyl("LanternGlass", (0, 0, 0.002), 0.030, 0.030, 0.060, 18, GLOW, lantern)
cyl("LanternBase", (0, 0, -0.042), 0.032, 0.034, 0.026, 16, METAL, lantern)
torus("LanternHandle", (0, 0, 0.086), 0.032, 0.005, METAL, lantern, rot=(math.pi / 2, 0, 0), maj=18, minr=6)
box("LanternStrap", (0, 0.038, 0.112), (0.032, 0.080, 0.017), 0.006, 2, BOOT_SOLE, lantern, rot=(0.12, 0, 0))

# ---------------------------------------------------------------- staff
staff_pts = [(0.274, -0.084, 0.004), (0.270, -0.070, 0.220), (0.258, -0.056, 0.430),
             (0.244, -0.040, 0.620), (0.232, -0.026, 0.800)]
poly_curve("Staff", staff_pts, 0.017, WOOD, root)
sphere("StaffKnot", (0.256, -0.062, 0.330), 0.027, (1, 0.9, 1.25), 16, 12, WOOD, root)
sphere("StaffTop", (0.232, -0.026, 0.806), 0.023, (1, 1, 1), 18, 12, WOOD, root)

# ---------------------------------------------------------------- rig helpers + finish

# Every part keeps its own origin so future bones have something to weight.
for o in PARTS:
    o.select_set(False)

# auto-smooth keeps bevels crisp and the head round
bpy.ops.object.select_all(action="DESELECT")
for o in PARTS:
    o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
try:
    bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
except Exception as exc:  # older/newer operator names
    print("auto smooth skipped:", exc)

# a small ground plane for the preview only, never exported
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
floor = bpy.context.object
floor.name = "PreviewFloor"
floor.data.materials.append(mat("Floor", "#F3E4D0", 1.0))
floor.is_shadow_catcher = True
# Preview renders keep a transparent film (the cream backdrop is composited outside Blender), so
# the floor is only for whoever opens the file.
floor.hide_render = True

# ---------------------------------------------------------------- reference board

ref_coll = bpy.data.collections.new("Reference")
bpy.context.scene.collection.children.link(ref_coll)
try:
    img = bpy.data.images.load(SHEET)
    bpy.ops.object.empty_add(type="IMAGE", location=(1.95, 0.0, 0.72))
    board = bpy.context.object
    board.name = "角色设定图"
    board.data = img
    board.empty_display_size = 0.62
    board.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.collection.objects.unlink(board)
    ref_coll.objects.link(board)
    ref_coll.hide_render = True
except Exception as exc:
    print("reference board skipped:", exc)

# ---------------------------------------------------------------- render setup

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = 820
scene.render.resolution_y = 1120
transforms = [v.name for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items]
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = -0.45

world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = rgba("#FBEFE0")
bg.inputs[1].default_value = 0.7

target = bpy.data.objects.new("Aim", None)
bpy.context.collection.objects.link(target)
target.location = (0, 0, 0.66)

def add_light(name, loc, size, energy, color="#FFFFFF"):
    data = bpy.data.lights.new(name, "AREA")
    data.size = size
    data.energy = energy
    data.color = rgba(color)[:3]
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    o.location = loc
    c = o.constraints.new("TRACK_TO")
    c.target = target
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return o

add_light("Key", (-1.5, -2.0, 2.3), 2.6, 150, "#FFF2DE")
add_light("Fill", (2.3, -1.5, 1.0), 3.4, 60, "#E8EEFF")
add_light("Rim", (0.6, 2.3, 1.9), 2.8, 110, "#FFD9A8")

# Freestyle ink: the sheet is a drawn illustration, so the honest comparison has an outline too.
scene.render.use_freestyle = True
view_layer = bpy.context.view_layer
view_layer.use_freestyle = True
fs = view_layer.freestyle_settings
fs.crease_angle = math.radians(135)
if not fs.linesets:
    fs.linesets.new("Ink")
ls = fs.linesets[0]
if ls.linestyle is None:
    ls.linestyle = bpy.data.linestyles.new("Ink")
ls.linestyle.color = rgba(INK_COLOR)[:3]
ls.linestyle.thickness = 1.15

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 1.55
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"

# ---------------------------------------------------------------- export + save

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(RENDER_DIR, exist_ok=True)

bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for o in root.children_recursive:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
try:
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

if "--render" in sys.argv:
    views = [
        ("front", (0.0, -3.4, 0.68), (0, 0, 0.66), 1.40, "ORTHO"),
        ("three-quarter", (1.55, -2.75, 1.10), (0, 0, 0.66), 1.40, "ORTHO"),
        ("back", (-1.6, 2.9, 1.0), (0, 0, 0.66), 1.40, "ORTHO"),
        ("side", (3.3, -0.4, 0.78), (0, 0, 0.66), 1.40, "ORTHO"),
        ("closeup-face", (0.0, -2.6, 0.95), (0, 0, 0.95), 0.80, "ORTHO"),
        ("closeup-hand", (0.30, -2.5, 0.50), (0.20, -0.03, 0.47), 0.46, "ORTHO"),
        ("hero", (1.05, -2.45, 0.95), (0, 0, 0.62), 0.0, "PERSP"),
    ]
    only = os.environ.get("VIEWS")
    if only:
        keep = set(only.split(","))
        views = [v for v in views if v[0] in keep]
    for name, loc, aim, scale, kind in views:
        cam.location = loc
        target.location = aim
        cam.data.type = kind
        if kind == "ORTHO":
            cam.data.ortho_scale = scale
        else:
            cam.data.lens = 95
        scene.render.filepath = os.path.join(RENDER_DIR, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name)

print("OBJECTS", len(PARTS))
print("GLB", os.path.getsize(OUT_GLB))
print("BLEND", OUT_BLEND)
