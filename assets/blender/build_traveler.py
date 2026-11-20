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

# palette from the character sheet
SKIN = mat("Skin", "#F2CFB2", 0.72)
SKIN_SHADE = mat("SkinShade", "#E0B396", 0.75)
JACKET = mat("Jacket", "#CC6B4B", 0.9)
JACKET_DARK = mat("JacketDark", "#A8503A", 0.9)
CREAM = mat("Cream", "#F8EED7", 0.95)
BEANIE = mat("Beanie", "#489D9B", 0.95)
BEANIE_DARK = mat("BeanieDark", "#3A8280", 0.95)
PANTS = mat("Pants", "#465761", 0.92)
BOOT = mat("Boot", "#6B4A2F", 0.85)
BOOT_SOLE = mat("BootSole", "#4B362F", 0.9)
CANVAS = mat("Canvas", "#B4A887", 0.95)
CANVAS_DARK = mat("CanvasDark", "#8E8467", 0.95)
BEDROLL = mat("Bedroll", "#AB4237", 0.92)
WOOD = mat("Wood", "#7A5634", 0.85)
INK = mat("Ink", "#3B2A20", 0.55)
BLUSH = mat("Blush", "#E89B8B", 0.9)
METAL = mat("LampMetal", "#6E6255", 0.45, 0.6)
GLOW = mat("LampGlow", "#FFE6A8", 0.4, 0.0, emit="#FFC35A", emit_strength=12.0)

# ---------------------------------------------------------------- body
# Proportion target from the character sheet: a little over 2.5 heads, head about 38% of the
# height, short thick legs, chunky boots. Total 1.29 units tall.

for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    cyl("Leg" + tag, (side * 0.086, 0, 0.255), 0.070, 0.062, 0.28, 20, PANTS, root)
    sphere("Knee" + tag, (side * 0.086, 0, 0.128), 0.066, (1, 1, 0.92), 20, 12, PANTS, root)
    box("Boot" + tag, (side * 0.086, -0.03, 0.085), (0.128, 0.20, 0.125), 0.05, 4, BOOT, root)
    box("Sole" + tag, (side * 0.086, -0.032, 0.026), (0.138, 0.215, 0.052), 0.022, 3, BOOT_SOLE, root)

# jacket: a heavily rounded box reads as a soft anorak
box("Jacket", (0, 0, 0.545), (0.36, 0.27, 0.40), 0.085, 6, JACKET, root)
torus("Hem", (0, 0, 0.356), 0.163, 0.030, JACKET_DARK, root, scale=(1, 0.88, 1))
torus("Collar", (0, 0, 0.728), 0.135, 0.034, JACKET_DARK, root, scale=(1, 0.88, 1))
box("Zip", (0, -0.150, 0.545), (0.022, 0.014, 0.352), 0.005, 2, CREAM, root)
sphere("ZipPull", (0, -0.158, 0.706), 0.019, (1, 0.55, 1.35), 14, 10, JACKET_DARK, root)
torus("ZipRing", (0, -0.157, 0.682), 0.016, 0.005, JACKET_DARK, root, rot=(math.pi / 2, 0, 0), maj=14, minr=6)

# arms: hinged at the shoulder so a rig can swing them later; the right one is turned down and
# forward a little so the hand actually sits on the staff instead of beside it.
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    grip = side > 0
    cyl("Arm" + tag, (side * 0.192, -0.012 if grip else 0, 0.565), 0.056, 0.047, 0.24, 18, JACKET, root,
        rot=(-0.16 if grip else 0, side * -0.10, 0))
    sphere("Shoulder" + tag, (side * 0.183, 0, 0.678), 0.066, (1, 0.95, 0.95), 20, 12, JACKET, root)
    torus("Cuff" + tag, (side * 0.20, -0.03 if grip else 0, 0.448), 0.048, 0.016, JACKET_DARK, root)
    sphere("Hand" + tag, (0.224 if grip else side * 0.207, -0.05 if grip else -0.012, 0.44 if grip else 0.402),
           0.054, (0.95, 1.02, 1.0), 24, 14, SKIN, root)

# ---------------------------------------------------------------- head

HEAD_Z = 0.945
HEAD_R = 0.242
sphere("Head", (0, 0, HEAD_Z), HEAD_R, (1, 1, 1), 44, 26, SKIN, root)

for side in (-1, 1):
    sphere("Ear" + ("L" if side < 0 else "R"), (side * 0.243, 0.012, HEAD_Z - 0.012), 0.045,
           (0.55, 0.85, 1.0), 16, 12, SKIN, root)


def on_face(x, dz, out=0.0):
    """Y of the head surface at (x, HEAD_Z + dz), pushed `out` along -Y."""
    depth = HEAD_R * HEAD_R - x * x - dz * dz
    return -math.sqrt(max(depth, 0.0)) + out


for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    ex, ez = side * 0.092, -0.042
    ey = on_face(ex, ez, 0.004)
    sphere("Eye" + tag, (ex, ey, HEAD_Z + ez), 0.032, (1, 0.30, 1.10), 24, 16, INK, root)
    cx, cz = side * 0.156, -0.092
    sphere("Cheek" + tag, (cx, on_face(cx, cz, 0.003), HEAD_Z + cz), 0.044, (1, 0.26, 0.70), 18, 12, BLUSH, root)
arc("Mouth", 0, on_face(0, -0.128, 0.012), HEAD_Z - 0.128, 0.036, 204, 336, 0.0105, INK, root, steps=18)
sphere("Nose", (0, on_face(0, -0.082, 0.010), HEAD_Z - 0.082), 0.014, (1, 0.75, 0.9), 14, 10, SKIN_SHADE, root)

# hair peeking out from under the hat
dome("Hair", (0, 0.004, HEAD_Z), HEAD_R * 1.022, cut=0.02, seg=40, ring=18, material=INK, parent=root)
# fringe curls at the edge of the knit cap, following the head surface
# fringe: three curls over the forehead, the topmost edge of the hair under the cap
for i, (fx, fz) in enumerate(((-0.105, 0.088), (-0.035, 0.080), (0.040, 0.082), (0.108, 0.090))):
    fy = -math.sqrt(max((HEAD_R * 1.03) ** 2 - fx * fx - fz * fz, 0.0))
    sphere("Fringe%d" % i, (fx, fy * 0.99, HEAD_Z + fz), 0.030, (1.05, 0.6, 0.72), 16, 12, INK, root)

for i, a in enumerate((-1.32, -0.62, 0.22, 1.05)):
    tx, tz = 0.235 * math.sin(a), -0.045 + 0.02 * abs(a)
    ty = -math.sqrt(max(HEAD_R * HEAD_R * 1.01 - tx * tx - tz * tz, 0.0))
    sphere("Tuft%d" % i, (tx, ty * 0.98, HEAD_Z + tz), 0.036, (1.1, 0.7, 0.95), 14, 10, INK, root)

# beanie: dome + knit brim with ribs + pompom
dome("Beanie", (0, 0, HEAD_Z + 0.012), HEAD_R * 1.035, cut=0.04, seg=36, ring=18,
     material=BEANIE, parent=root)
torus("BeanieBrim", (0, 0, HEAD_Z + 0.126), 0.230, 0.044, BEANIE_DARK, root, scale=(1, 1.0, 1), maj=44, minr=14)
for i in range(16):
    a = math.tau * i / 16
    box("Rib%d" % i, (0.259 * math.cos(a), 0.259 * math.sin(a), HEAD_Z + 0.112),
        (0.016, 0.015, 0.082), 0.005, 2, BEANIE, root, rot=(0, 0, a))
sphere("Pompom", (0, 0, HEAD_Z + 0.295), 0.058, (1, 1, 0.92), 20, 14, CREAM, root)
for i, (dx, dy, dz) in enumerate(((0.052, 0.012, 0.018), (-0.052, -0.014, 0.026),
                                  (0.012, 0.052, -0.03), (-0.014, -0.05, -0.02))):
    sphere("PompomLobe%d" % i, (dx, dy, HEAD_Z + 0.295 + dz), 0.033, (1, 1, 1), 14, 10, CREAM, root)

# ---------------------------------------------------------------- neck
cyl("Neck", (0, 0, 0.70), 0.072, 0.076, 0.10, 18, SKIN, root)

# ---------------------------------------------------------------- scarf

torus("ScarfWrap", (0, 0, 0.75), 0.155, 0.058, CREAM, root, scale=(1, 0.94, 0.80), maj=36, minr=14)
torus("ScarfFold", (0, 0, 0.702), 0.158, 0.040, CREAM, root, scale=(1, 0.92, 0.9), maj=36, minr=12)
box("ScarfTail", (0.078, -0.126, 0.625), (0.092, 0.038, 0.185), 0.024, 3, CREAM, root, rot=(0.16, 0, 0.08))
box("ScarfTailEnd", (0.082, -0.129, 0.537), (0.086, 0.034, 0.032), 0.012, 2, CREAM, root, rot=(0.16, 0, 0.08))

# ---------------------------------------------------------------- backpack

box("PackBody", (0, 0.212, 0.60), (0.30, 0.20, 0.355), 0.06, 5, CANVAS, root)
box("PackFlap", (0, 0.222, 0.775), (0.308, 0.212, 0.078), 0.032, 4, CANVAS, root)
box("PackPocket", (0, 0.31, 0.525), (0.165, 0.05, 0.13), 0.02, 3, CANVAS_DARK, root)
box("PackBuckle", (0, 0.315, 0.60), (0.038, 0.022, 0.058), 0.008, 2, BOOT_SOLE, root)
cyl("Bedroll", (0, 0.222, 0.845), 0.075, 0.075, 0.38, 20, BEDROLL, root, rot=(0, math.pi / 2, 0))
for x in (-0.12, 0.12):
    torus("BedrollTie%d" % int(x * 1000), (x, 0.222, 0.845), 0.077, 0.010, BOOT_SOLE, root,
          rot=(0, math.pi / 2, 0), maj=20, minr=8)
for side in (-1, 1):
    # The straps have to sit proud of the jacket, or they vanish inside it.
    box("Strap" + ("L" if side < 0 else "R"), (side * 0.094, -0.152, 0.60),
        (0.046, 0.030, 0.31), 0.012, 3, CANVAS_DARK, root, rot=(0.05, 0, 0))
    box("StrapTop" + ("L" if side < 0 else "R"), (side * 0.094, 0.03, 0.782),
        (0.046, 0.30, 0.030), 0.010, 3, CANVAS_DARK, root)
    box("StrapBuckle" + ("L" if side < 0 else "R"), (side * 0.094, -0.168, 0.565),
        (0.052, 0.016, 0.05), 0.006, 2, BOOT_SOLE, root)

# lantern hanging off the pack
lantern = bpy.data.objects.new("Lantern", None)
lantern.empty_display_size = 0.05
bpy.context.collection.objects.link(lantern)
lantern.parent = root
lantern.location = (0.185, 0.215, 0.46)
cyl("LanternTop", (0, 0, 0.048), 0.032, 0.021, 0.032, 14, METAL, lantern)
cyl("LanternGlass", (0, 0, 0.002), 0.028, 0.028, 0.058, 16, GLOW, lantern)
cyl("LanternBase", (0, 0, -0.040), 0.030, 0.032, 0.024, 14, METAL, lantern)
torus("LanternHandle", (0, 0, 0.082), 0.030, 0.005, METAL, lantern, rot=(math.pi / 2, 0, 0), maj=16, minr=6)
box("LanternStrap", (0, 0.036, 0.108), (0.030, 0.075, 0.016), 0.006, 2, BOOT_SOLE, lantern, rot=(0.12, 0, 0))

# a thumb over the staff, so the hand reads as gripping it
sphere("ThumbR", (0.232, -0.070, 0.455), 0.028, (1.1, 1.0, 1.3), 14, 10, SKIN, root)
sphere("ThumbL", (-0.192, -0.024, 0.425), 0.024, (1, 1, 1.3), 14, 10, SKIN, root)

# ---------------------------------------------------------------- staff
# Passes through the right hand (0.229, -0.05, 0.44) rather than floating next to it.
staff_pts = [(0.258, -0.082, 0.004), (0.256, -0.068, 0.24), (0.250, -0.056, 0.44),
             (0.238, -0.040, 0.70), (0.226, -0.024, 0.86)]
poly_curve("Staff", staff_pts, 0.016, WOOD, root)
sphere("StaffKnot", (0.254, -0.062, 0.33), 0.026, (1, 0.9, 1.3), 14, 10, WOOD, root)
sphere("StaffTop", (0.226, -0.024, 0.868), 0.021, (1, 1, 1), 16, 10, WOOD, root)

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
        ("front", (0.0, -3.4, 0.72), (0, 0, 0.66), 1.42),
        ("three-quarter", (2.35, -2.45, 1.15), (0, 0, 0.66), 1.42),
        ("back", (-1.6, 2.9, 1.0), (0, 0, 0.66), 1.42),
        ("side", (3.3, -0.4, 0.8), (0, 0, 0.66), 1.42),
        ("closeup-face", (0.0, -2.6, 0.95), (0, 0, 0.95), 0.78),
        ("closeup-hand", (0.30, -2.5, 0.50), (0.20, -0.03, 0.47), 0.46),
    ]
    for name, loc, aim, scale in views:
        cam.location = loc
        target.location = aim
        cam.data.ortho_scale = scale
        scene.render.filepath = os.path.join(RENDER_DIR, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name)

print("OBJECTS", len(PARTS))
print("GLB", os.path.getsize(OUT_GLB))
print("BLEND", OUT_BLEND)
