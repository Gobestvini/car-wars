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
OUT = ROOT / 'docs/art/models/player-sedan-v2'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from sedan_texture import COLORS, TILES, SIZE, shade

def linear(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055)**2.4 for v in rgb) + (1,)

material = bpy.data.materials.new('Car Stars shared concept atlas')
material.use_nodes = True
material.use_backface_culling = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value = .72
shader.inputs['Metallic'].default_value = 0
shader.inputs['Specular IOR Level'].default_value = .22

# One shared authored texture. Cell padding keeps mipmaps inside each surface.
atlas=bpy.data.images.new('Car Stars concept sedan atlas 1024',width=SIZE,height=SIZE,alpha=True)
atlas.colorspace_settings.name='sRGB'
pixels=[]
cell=SIZE//4
for y in range(SIZE):
    for x in range(SIZE):
        tile=TILES[(x//cell)+4*(y//cell)]
        pixels.extend(shade(tile,(x%cell)/(cell-1),(y%cell)/(cell-1)))
atlas.pixels.foreach_set(pixels)
atlas.filepath_raw=str(OUT/'sedan-atlas.png')
atlas.file_format='PNG'
atlas.save()
atlas.pack()
atlas.use_fake_user=True
image_node=material.node_tree.nodes.new('ShaderNodeTexImage')
image_node.image=atlas
material.node_tree.links.new(image_node.outputs['Color'],shader.inputs['Base Color'])

def uv_tile(obj,tile,face_tiles=None):
    uv=obj.data.uv_layers.get('UVMap') or obj.data.uv_layers.new(name='UVMap')
    coords=[v.co for v in obj.data.vertices]
    low=[min(p[i] for p in coords) for i in range(3)]
    high=[max(p[i] for p in coords) for i in range(3)]
    for poly in obj.data.polygons:
        name=face_tiles(poly) if face_tiles else tile
        tid=TILES.index(name)
        axes=sorted(range(3),key=lambda a:abs(poly.normal[a]))[:2]
        # Blender X,Y,Z correspond to game X,-Z,Y.
        axes=sorted(axes)
        for loop in poly.loop_indices:
            p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            values=[(p[a]-low[a])/max(high[a]-low[a],1e-6) for a in axes]
            uv.data[loop].uv=((tid%4+.03125+values[0]*.9375)/4,
                              (tid//4+.03125+values[1]*.9375)/4)

def quad_uv(obj,face_tiles,faces,corners):
    """Map each cabin quad to its own tile, without world-axis stretching."""
    uv=obj.data.uv_layers.active
    for poly in obj.data.polygons:
        tid=TILES.index(face_tiles[poly.index])
        by_vertex=dict(zip(faces[poly.index],corners[poly.index]))
        for loop in poly.loop_indices:
            index=obj.data.loops[loop].vertex_index
            p=obj.data.vertices[index].co
            if face_tiles[poly.index]=='side-glass':
                u,v=(-p.y+1.10)/2.03,(p.z-.32)/.52
            elif face_tiles[poly.index] in ['windshield','rear-glass']:
                u,v=(p.x+.835)/1.67,(p.z-.32)/.52
            else:
                u,v=by_vertex[index]
            uv.data[loop].uv=((tid%4+.03125+u*.9375)/4,
                              (tid//4+.03125+v*.9375)/4)

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
    uv_tile(obj,color if color in TILES else 'paint')
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
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return colorize(obj, color)

parts = []
shell = box('Quarter panels and hood', (0, -.11, 0), (1.82, .86, 4.0), 'paint')
active(shell)
sub = shell.modifiers.new('Local impact support grid', 'SUBSURF')
sub.subdivision_type = 'SIMPLE'
sub.levels = 2
bpy.ops.object.modifier_apply(modifier=sub.name)
for z in [-1.15, 1.15]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=.49, depth=2.4, location=convert((0, -.44, z)), rotation=(0, math.pi/2, 0))
    cutter = bpy.context.object
    active(shell)
    mod = shell.modifiers.new('Wheel clearance', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
for vertex in shell.data.vertices:
    game_z=-vertex.co.y
    if vertex.co.z>.15:
        slope=max(0,(game_z-.93)/1.07,(-game_z-1.10)/.90)
        vertex.co.z-=.075*slope
shell.data.update()
active(shell)
edge = shell.modifiers.new('Body edge chamfer', 'BEVEL')
edge.width = .055
edge.segments = 2
edge.angle_limit = .6
bpy.ops.object.modifier_apply(modifier=edge.name)
colorize(shell, 'paint')
def shell_tile(p):
    if abs(p.normal.x)>.9:
        return 'doors'
    # Boolean cut surfaces inside the wheel wells should be dark rubber/trim,
    # not yellow body paint visible above the smaller tire.
    if any(.43<math.hypot(-p.center.y-z,p.center.z+.44)<.53 for z in [-1.15,1.15]):
        return 'trim'
    if p.normal.z>.9:
        return 'hood' if p.center.y<0 else 'trunk'
    return 'paint'
uv_tile(shell,'paint',shell_tile)
parts.append(shell)

# Concept has a long roof and two full doors; opaque windows share cabin faces.
points = [(-.835,.32,-1.10),(.835,.32,-1.10),(.835,.32,.93),(-.835,.32,.93),
          (-.70,.84,-.82),(.70,.84,-.82),(.70,.84,.53),(-.70,.84,.53)]
cabin_faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
cab=mesh('Painted cabin with flush textured windows',points,cabin_faces,'paint')
quad_uv(cab,['paint','roof','rear-glass','windshield','side-glass','side-glass'],cabin_faces,[
    [(0,0),(0,1),(1,1),(1,0)],[(0,0),(1,0),(1,1),(0,1)],
    [(0,0),(1,0),(1,1),(0,1)],[(0,0),(0,1),(1,1),(1,0)],
    [(0,0),(0,1),(1,1),(1,0)],[(0,0),(1,0),(1,1),(0,1)]])
parts.append(cab)
for side in [-1,1]:
    parts.append(box('Side sill', (side*.918,-.46,0), (.035,.16,1.26), 'trim', .015))
    # Door seams and window pillars are flush atlas details. No floating strips
    # or separate glass sheets that can intersect when the cabin deforms.
    # Dark arch strips, following the actual cutout, without boolean/rig at runtime.
    for z in [-1.15,1.15]:
        ring = []
        for radius in [.492,.535]:
            for i in range(11):
                start = math.asin(-.08/radius)
                angle = start + (math.pi - 2*start)*i/10
                ring.append((side*.918, -.44+radius*math.sin(angle), z+radius*math.cos(angle)))
        parts.append(mesh('Wheel arch trim', ring, [(i,i+1,i+12,i+11) for i in range(10)], 'trim'))
for z in [-2.08,2.08]:
    bumper_z = 2.015 if z > 0 else -2.015
    parts.append(box('Bumper', (0,-.37,bumper_z), (1.90,.34,.21), 'trim', .035))
    for side in [-1,1]:
        parts.append(box('Bumper corner return', (side*.920,-.37,(1 if z>0 else -1)*1.88), (.065,.34,.30), 'trim', .025))
    if z>0:
        parts.append(box('Dark grille', (0,-.01,2.007), (.94,.26,.04), 'grille', .012))
        for x in [-.635,.635]:
            parts.append(box('Amber headlamp surround', (x,-.005,2.016), (.405,.325,.04), 'amber', .015))
            parts.append(box('Cream square headlamp', (x,-.005,2.037), (.335,.265,.014), 'lamp', .009))
    else:
        plate=box('Rear plate recess', (0,-.01,-2.007), (.68,.23,.04), 'grille', .014)
        uv_tile(plate,'plate')
        parts.append(plate)
        for x in [-.64,.64]:
            # Rear lamps are a single red lens. Reverse adds red intensity in
            # the runtime shader instead of introducing a white lens.
            parts.append(box('Tail lamp', (x,-.005,-2.016), (.35,.23,.04), 'tail', .014))
parts.append(box('Simple underbody', (0,-.51,0), (1.22,.06,2.8), 'grille', .01))

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
    steps = 16
    for axle,radius in [(-.125,.385),(-.085,.43),(.085,.43),(.125,.385)]:
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
        for radius in [.385,.28,.265,.235]:
            for i in range(steps):
                a=2*math.pi*i/steps
                verts.append((side*(.126 + (.004 if radius<.29 else 0)),radius*math.cos(a),radius*math.sin(a)))
        for ring,col in [(0,'tire'),(1,'hub'),(2,'hub')]:
            for i in range(steps):
                j=(i+1)%steps
                faces.append((offset+ring*steps+i,offset+ring*steps+j,offset+(ring+1)*steps+j,offset+(ring+1)*steps+i))
                face_colors.append(col)
        faces.append(tuple(offset+3*steps+i for i in range(steps)))
        face_colors.append('hub')
    obj = mesh(name,verts,faces,'tire')
    attr=obj.data.color_attributes['Color']
    for poly,col in zip(obj.data.polygons,face_colors):
        for loop in poly.loop_indices:
            attr.data[loop].color=linear(COLORS[col])
    uv_tile(obj,'tire',lambda p:face_colors[p.index])
    for poly in obj.data.polygons:
        poly.use_smooth=True
        if face_colors[poly.index]=='hub':
            tid=TILES.index('hub')
            for loop in poly.loop_indices:
                p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                u,v=.5+p.y/.56,.5+p.z/.56
                obj.data.uv_layers.active.data[loop].uv=((tid%4+.03125+u*.9375)/4,(tid//4+.03125+v*.9375)/4)
    obj.location=convert((x,-.44,z))
    return obj

wheels=[wheel('wheel-front-left',-.77,1.15),wheel('wheel-front-right',.77,1.15),
        wheel('wheel-rear-left',-.77,-1.15),wheel('wheel-rear-right',.77,-1.15)]
car_objects = [body]+wheels
for obj in car_objects:
    active(obj)
    if obj==body:
        for poly in obj.data.polygons:
            poly.use_smooth=True
        bm=bmesh.new()
        bm.from_mesh(obj.data)
        for edge in bm.edges:
            if edge.is_manifold and edge.calc_face_angle()>.55:
                edge.smooth=False
        bm.to_mesh(obj.data)
        bm.free()
        normals=obj.modifiers.new('Broad panels and rounded chamfers','WEIGHTED_NORMAL')
        normals.keep_sharp=True
        normals.weight=50
        bpy.ops.object.modifier_apply(modifier=normals.name)
    # Ensure one material primitive per object, even after joining all colored parts.
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.material_index=0
    # The atlas replaces vertex color; do not multiply the two palettes at runtime.
    for attr in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(attr)
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
    export_texcoords=True,export_cameras=False,export_lights=False)

# Studio objects are only in the .blend; never exported into the game.
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.87))
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
reference.use_fake_user=True
reference.pack()
scene['concept_reference']=reference.name
scene['game_axes']='GLB: +X right, +Y up, +Z nose. Blender: +X right, +Z up, -Y nose.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'player-sedan.blend'))
report={'generator':'Blender '+bpy.app.version_string,'palette_srgb':COLORS,
        'axes':'Game +X right +Y up +Z nose; Blender x,-z,y',
        'objects':[{ 'name':o.name,'triangles':len(o.data.polygons),'vertices':len(o.data.vertices),
                    'materials':len(o.data.materials),'scale':list(o.scale)} for o in car_objects],
        'triangles':sum(len(o.data.polygons) for o in car_objects),
        'glb_bytes':export_path.stat().st_size,'textures':1,'atlas_size':[SIZE,SIZE],
        'visual_wheel_radius':.43,'visual_wheel_width':.26,
        'physics':'Existing cannon-es bodies, wheel mounts, radius .45 and wheelbase 2.3m preserved'}
(OUT/'asset-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('CAR_ASSET_REPORT '+json.dumps(report))
bpy.ops.render.render(write_still=True)
