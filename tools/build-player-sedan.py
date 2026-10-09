"""Rebuild the authored low-poly player car with Blender --background --python.

All design coordinates below are game metres: +X right, +Y up, +Z nose.
Blender receives (x, -z, y); its glTF exporter restores game coordinates.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/models/player-sedan'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

COLORS = {'paint': '#ffc12f', 'glass': '#202c49', 'trim': '#535a6b',
          'tire': '#20252e', 'hub': '#afb6c5', 'grille': '#19202d',
          'lamp': '#fff0b8', 'amber': '#e7a227', 'tail': '#db3345'}

def linear(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055)**2.4 for v in rgb) + (1,)

material = bpy.data.materials.new('Car matte vertex palette')
material.use_nodes = True
material.use_backface_culling = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value = .78
shader.inputs['Metallic'].default_value = .02
vertex_color = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex_color.layer_name = 'Color'
material.node_tree.links.new(vertex_color.outputs['Color'], shader.inputs['Base Color'])

def convert(p):
    return (p[0], -p[2], p[1])

def colorize(obj, color):
    attr = obj.data.color_attributes.get('Color') or obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    rgba = linear(COLORS[color])
    for entry in attr.data:
        entry.color = rgba
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = False
        poly.material_index = 0
    return obj

def mesh(name, points, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata([convert(p) for p in points], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Open glass/trim sheets need an explicit outward normal; mirrored sides
    # cannot rely on recalc_face_normals to infer an enclosed volume.
    outward = None
    if name == 'Windshield':
        outward = (0, .4, 1)
    elif name == 'Rear glass':
        outward = (0, .4, -1)
    elif name in ['Front side glass', 'Rear side glass', 'Wheel arch trim']:
        outward = (1 if points[0][0] > 0 else -1, 0, 0)
    for face in bm.faces:
        direction = Vector(convert(outward)) if outward else (face.calc_center_median() if name.startswith('wheel-') else None)
        if direction is not None and face.normal.dot(direction) < 0:
            face.normal_flip()
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return colorize(obj, color)

def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def box(name, center, size, color, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=convert(center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Single segment edge chamfer', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return colorize(obj, color)

parts = []
shell = box('Quarter panels and hood', (0, -.07, 0), (1.74, .74, 4.12), 'paint')
active(shell)
sub = shell.modifiers.new('Local impact support grid', 'SUBSURF')
sub.subdivision_type = 'SIMPLE'
sub.levels = 2
bpy.ops.object.modifier_apply(modifier=sub.name)
for z in [-1.15, 1.15]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=.49, depth=2.4, location=convert((0, -.54, z)), rotation=(0, math.pi/2, 0))
    cutter = bpy.context.object
    active(shell)
    mod = shell.modifiers.new('Wheel clearance', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
active(shell)
edge = shell.modifiers.new('Body edge chamfer', 'BEVEL')
edge.width = .018
edge.segments = 1
edge.angle_limit = .6
bpy.ops.object.modifier_apply(modifier=edge.name)
colorize(shell, 'paint')
parts.append(shell)

# One broad angular cabin. Small glass overlays leave actual painted pillars.
points = [(-.79,.30,-1.12),(.79,.30,-1.12),(.79,.30,.72),(-.79,.30,.72),
          (-.66,.88,-.80),(.66,.88,-.80),(.66,.88,.27),(-.66,.88,.27)]
parts.append(mesh('Painted cabin pillars and roof', points,
                  [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], 'paint'))
parts.append(mesh('Windshield', [(-.705,.357,.681),(.705,.357,.681),(.605,.826,.316),(-.605,.826,.316)], [(0,1,2,3)], 'glass'))
parts.append(mesh('Rear glass', [(-.704,.357,-1.094),(-.605,.826,-.836),(.605,.826,-.836),(.704,.357,-1.094)], [(0,1,2,3)], 'glass'))
for side in [-1,1]:
    def sx(y):
        return side * (.79 - (y-.30) * (.13/.58) + .004)
    parts.append(mesh('Front side glass', [(sx(.36),.36,-.12),(sx(.36),.36,.64),
                         (sx(.825),.825,.24),(sx(.825),.825,-.12)], [(0,1,2,3)], 'glass'))
    parts.append(mesh('Rear side glass', [(sx(.36),.36,-1.04),(sx(.36),.36,-.18),
                         (sx(.825),.825,-.18),(sx(.825),.825,-.77)], [(0,1,2,3)], 'glass'))
    for z in [-.72,.35]:
        parts.append(box('Recessed door handle', (side*.878,.18,z), (.025,.035,.14), 'trim', .004))
    parts.append(box('Centre door seam', (side*.873,-.055,-.15), (.006,.40,.009), 'trim'))
    parts.append(box('Side sill', (side*.88,-.345,0), (.045,.17,1.27), 'trim', .008))
    parts.append(box('Mirror stalk', (side*.906,.35,.57), (.10,.045,.045), 'trim'))
    parts.append(box('Painted mirror', (side*.983,.37,.57), (.13,.115,.16), 'paint', .018))
    # Dark arch strips, following the actual cutout, without boolean/rig at runtime.
    for z in [-1.15,1.15]:
        ring = []
        for radius in [.492,.535]:
            for i in range(9):
                start = math.asin(.10/radius)
                angle = start + (math.pi - 2*start)*i/8
                ring.append((side*.878, -.54+radius*math.sin(angle), z+radius*math.cos(angle)))
        parts.append(mesh('Wheel arch trim', ring, [(i,i+1,i+10,i+9) for i in range(8)], 'trim'))
for z in [-2.08,2.08]:
    parts.append(box('Bumper', (0,-.235,z), (1.79,.29,.18), 'trim', .028))
    if z>0:
        parts.append(box('Dark grille', (0,.075,2.071), (.91,.21,.025), 'grille'))
        for y in [.01,.09,.17]:
            parts.append(box('Grille slat', (0,y,2.09), (.87,.018,.016), 'trim'))
        for x in [-.635,.635]:
            parts.append(box('Amber headlamp surround', (x,.075,2.084), (.39,.275,.028), 'amber', .012))
            parts.append(box('Cream square headlamp', (x,.075,2.102), (.32,.215,.014), 'lamp', .006))
    else:
        parts.append(box('Rear plate recess', (0,.045,-2.075), (.64,.19,.026), 'grille', .01))
        for x in [-.64,.64]:
            parts.append(box('Tail lamp', (x,.065,-2.079), (.37,.23,.027), 'tail', .009))
parts.append(box('Simple underbody', (0,-.435,0), (1.22,.06,2.8), 'grille', .01))

active(shell)
for obj in parts:
    obj.select_set(True)
bpy.ops.object.join()
body = bpy.context.object
body.name = 'body'
bpy.context.scene.cursor.location = (0,0,0)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
body['role'] = 'Shared sedan body; future police trim can be added separately'
body['paint_srgb'] = COLORS['paint']
body['deformation'] = 'Grid supports local collision dents; no collider change'

def wheel(name, x, z):
    verts, faces, face_colors = [], [], []
    steps = 12
    for axle,radius in [(-.15,.40),(-.115,.45),(.115,.45),(.15,.40)]:
        for i in range(steps):
            a = 2*math.pi*i/steps
            verts.append((axle,radius*math.cos(a),radius*math.sin(a)))
    for ring in range(3):
        for i in range(steps):
            j=(i+1)%steps
            faces.append((ring*steps+i,ring*steps+j,(ring+1)*steps+j,(ring+1)*steps+i))
            face_colors.append('tire')
    for side in [-1,1]:
        offset = len(verts)
        for radius in [.40,.285,.255]:
            for i in range(steps):
                a=2*math.pi*i/steps
                verts.append((side*(.151 + (.006 if radius<.30 else 0)),radius*math.cos(a),radius*math.sin(a)))
        for ring,col in [(0,'tire'),(1,'trim')]:
            for i in range(steps):
                j=(i+1)%steps
                faces.append((offset+ring*steps+i,offset+ring*steps+j,offset+(ring+1)*steps+j,offset+(ring+1)*steps+i))
                face_colors.append(col)
        faces.append(tuple(offset+2*steps+i for i in range(steps)))
        face_colors.append('hub')
    obj = mesh(name,verts,faces,'tire')
    attr=obj.data.color_attributes['Color']
    for poly,col in zip(obj.data.polygons,face_colors):
        for loop in poly.loop_indices:
            attr.data[loop].color=linear(COLORS[col])
    obj.location=convert((x,-.54,z))
    return obj

wheels=[wheel('wheel-front-left',-.77,1.15),wheel('wheel-front-right',.77,1.15),
        wheel('wheel-rear-left',-.77,-1.15),wheel('wheel-rear-right',.77,-1.15)]
car_objects = [body]+wheels
for obj in car_objects:
    active(obj)
    # Ensure one material primitive per object, even after joining all colored parts.
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.material_index=0
    tri=obj.modifiers.new('Game triangles','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    obj.data.update()

scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
scene.world.color=(.18,.18,.18)
for obj in car_objects:
    obj.select_set(True)
active(body)
for obj in car_objects:
    obj.select_set(True)
export_path=ROOT/'public/models/player-sedan.glb'
bpy.ops.export_scene.gltf(filepath=str(export_path),export_format='GLB',use_selection=True,
    export_yup=True,export_extras=True,export_materials='EXPORT',export_normals=True,
    export_texcoords=False,export_cameras=False,export_lights=False)

# Studio objects are only in the .blend; never exported into the game.
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-1.0))
floor=bpy.context.object
floor.name='STUDIO floor (not exported)'
floor_mat=bpy.data.materials.new('Studio cream')
floor_mat.diffuse_color=(.73,.71,.65,1)
floor.data.materials.append(floor_mat)
bpy.ops.object.camera_add(location=convert((6,4.1,7)))
camera=bpy.context.object
camera.name='STUDIO camera (not exported)'
target=Vector(convert((0,-.05,0)))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=6.1
scene.camera=camera
for name,loc,power,size in [('Key',(-3,7,4),850,5),('Fill',(4,3,1),450,5),('Rim',(0,5,-5),650,4)]:
    bpy.ops.object.light_add(type='AREA',location=convert(loc))
    light=bpy.context.object
    light.name='STUDIO '+name
    light.data.energy=power
    light.data.shape='DISK'
    light.data.size=size
    light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.render.resolution_x=1200
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'
scene.view_settings.exposure=-1.1
scene.view_settings.look='None'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'preview.png')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
active(body)
car_collection=bpy.data.collections.new('CAR | shared sedan')
scene.collection.children.link(car_collection)
studio_collection=bpy.data.collections.new('STUDIO | not exported')
scene.collection.children.link(studio_collection)
for obj in list(scene.objects):
    dest=car_collection if obj in car_objects else studio_collection
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    dest.objects.link(obj)
reference=bpy.data.images.load(str(ROOT/'docs/art/vehicles/2026-10-09/01-yellow-getaway.png'))
reference.name='REFERENCE | yellow getaway turnaround'
reference.pack()
scene['concept_reference']=reference.name
scene['game_axes']='GLB: +X right, +Y up, +Z nose. Blender: +X right, +Z up, -Y nose.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'player-sedan.blend'))
report={'generator':'Blender '+bpy.app.version_string,'palette_srgb':COLORS,
        'axes':'Game +X right +Y up +Z nose; Blender x,-z,y',
        'objects':[{ 'name':o.name,'triangles':len(o.data.polygons),'vertices':len(o.data.vertices),
                    'materials':len(o.data.materials),'scale':list(o.scale)} for o in car_objects],
        'triangles':sum(len(o.data.polygons) for o in car_objects),
        'glb_bytes':export_path.stat().st_size,'textures':0,
        'physics':'Existing cannon-es bodies, wheel mounts, radius .45 and wheelbase 2.3m preserved'}
(OUT/'asset-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('CAR_ASSET_REPORT '+json.dumps(report))
bpy.ops.render.render(write_still=True)
