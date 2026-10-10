"""Derive the concept sedan family from the approved player Blender source.
Run: blender --background --python tools/build-traffic-sedans.py
"""
import bpy
import bmesh
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sedan_texture import shade, TILES, rgb

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/art/models/traffic-sedans'
OUT.mkdir(parents=True, exist_ok=True)
VARIANTS = [('grey', '#a5a8b1', '03-grey-traffic.png'),
            ('green', '#66a47e', '04-green-traffic.png'),
            ('police', '#edf0f5', '02-police-patrol.png')]
SIZE = 512

def sample(tile, u, v, name, paint):
    color = shade(tile, u, v)
    r, g, b = color[:3]
    # Recolor painted details as well as broad panels, preserving seals/lenses.
    if tile in ['paint', 'doors', 'hood', 'trunk', 'roof', 'windshield', 'rear-glass', 'side-glass']:
        if r > g * 1.08 and g > b * 1.25:
            value = (.2126*r + .7152*g + .0722*b) / .758
            color = tuple(min(1, c*value) for c in paint)+(1,)
    uu, vv = (u-.03125)/.9375, (v-.03125)/.9375
    if tile == 'doors' and name == 'police':
        if .37 < vv < .73:
            color = rgb('#263853')+(1,)
            if min(abs(uu-s) for s in [.2675,.535,.775]) < .004:
                color = rgb('#142239')+(1,)
        if .73 < vv < .738:
            color = rgb('#b2bccd')+(1,)
        if any(abs(uu-c)<.024 and abs(vv-.805)<.030 for c in [.37,.6575]):
            color = rgb('#28303e')+(1,)
    return color

def beacon_box(name, x, z, size, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, .08, z))
    obj=bpy.context.object
    obj.name=name
    obj.dimensions=(size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel=obj.modifiers.new('Beacon edge chamfer', 'BEVEL')
    bevel.width=.018
    bevel.segments=1
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    mat=bpy.data.materials.new(name)
    mat.diffuse_color=(*rgb(color),1)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    # Blender colors are linear; use a scene-linear conversion for the lens.
    c=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb(color))
    bsdf.inputs['Base Color'].default_value=(*c,1)
    bsdf.inputs['Roughness'].default_value=.65
    obj.data.materials.append(mat)
    tri=obj.modifiers.new('Triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    return obj

def distant_wheel(source, material):
    # Keep round silhouettes: generic decimation turns the flat hubcaps square.
    points, faces, tiles=[], [], []
    steps=12
    for axle,radius in [(-.125,.385),(-.085,.43),(.085,.43),(.125,.385)]:
        for i in range(steps):
            a=2*math.pi*i/steps
            points.append((axle,-radius*math.sin(a),radius*math.cos(a)))
    for ring in range(3):
        for i in range(steps):
            j=(i+1)%steps
            faces.append((ring*steps+i,ring*steps+j,(ring+1)*steps+j,(ring+1)*steps+i))
            tiles.append('tire')
    for ring in [0,3]:
        faces.append(tuple(ring*steps+i for i in range(steps)))
        tiles.append('tire')
    for side in [-1,1]:
        start=len(points)
        for i in range(steps):
            a=2*math.pi*i/steps
            points.append((side*.131,-.265*math.sin(a),.265*math.cos(a)))
        faces.append(tuple(start+i for i in range(steps)))
        tiles.append('hub')
    data=bpy.data.meshes.new('Distant 12 sided wheel')
    data.from_pydata(points,[],faces)
    data.update()
    bm=bmesh.new();bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(data);bm.free()
    obj=bpy.data.objects.new('Distant wheel',data)
    bpy.context.collection.objects.link(obj)
    obj.location=source.location
    data.materials.append(material)
    uv=data.uv_layers.new(name='UVMap')
    for poly,tile in zip(data.polygons,tiles):
        tid=TILES.index(tile)
        for loop in poly.loop_indices:
            p=data.vertices[data.loops[loop].vertex_index].co
            u,v=(.5+p.y/.56,.5+p.z/.56) if tile=='hub' else (.5,.5)
            uv.data[loop].uv=((tid%4+.03125+u*.9375)/4,(tid//4+.03125+v*.9375)/4)
    return obj

reports=[]
for name, paint, concept in VARIANTS:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/art/models/player-sedan-v2/player-sedan.blend'))
    bpy.context.preferences.filepaths.save_version=0
    body=bpy.data.objects['body']
    wheels=[bpy.data.objects[n] for n in ['wheel-front-left','wheel-front-right','wheel-rear-left','wheel-rear-right']]
    objects=[body]+wheels
    material=body.data.materials[0]
    atlas=bpy.data.images.new(name+' concept atlas 512', width=SIZE, height=SIZE, alpha=True)
    atlas.colorspace_settings.name='sRGB'
    pixels=[]
    cell=SIZE//4
    for y in range(SIZE):
        for x in range(SIZE):
            tile=TILES[(x//cell)+4*(y//cell)]
            pixels.extend(sample(tile,(x%cell)/(cell-1),(y%cell)/(cell-1),name,rgb(paint)))
    atlas.pixels.foreach_set(pixels)
    atlas.filepath_raw=str(OUT/(name+'-atlas.png'))
    atlas.file_format='PNG'
    atlas.save()
    atlas.pack()
    material.node_tree.nodes.get('Image Texture').image=atlas
    material.name=name+' concept sedan atlas'
    body['variant']=name
    body['paint_srgb']=paint
    # Distant traffic: one decimated mesh, with the same UVs and silhouette.
    bpy.ops.object.select_all(action='DESELECT')
    copies=[]
    for obj in [body]:
        copy=obj.copy()
        copy.data=obj.data.copy()
        bpy.context.collection.objects.link(copy)
        copies.append(copy)
        copy.select_set(True)
    bpy.context.view_layer.objects.active=copies[0]
    bpy.ops.object.join()
    lod=bpy.context.object
    lod.name='lod'
    decimate=lod.modifiers.new('Distant traffic budget', 'DECIMATE')
    decimate.ratio=.35
    decimate.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    for wheel in wheels:
        distant_wheel(wheel,material).select_set(True)
    lod.select_set(True)
    bpy.context.view_layer.objects.active=lod
    bpy.ops.object.join()
    tri=lod.modifiers.new('Distant triangles','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    objects.append(lod)
    if name=='police':
        objects += [beacon_box('lightbar-base',0,.887,(1.02,.085,.32),'#26303e'),
                    beacon_box('lightbar-center',0,.985,(.30,.14,.28),'#edf0f5'),
                    beacon_box('beacon-red',-.33,.985,(.36,.14,.28),'#ee2737'),
                    beacon_box('beacon-blue',.33,.985,(.36,.14,.28),'#1675ff')]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        if name != 'police' or obj != lod: obj.select_set(True)
    bpy.context.view_layer.objects.active=body
    path=ROOT/'public/models'/f'{name}-sedan.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_yup=True, export_extras=True, export_materials='EXPORT', export_normals=True,
        export_texcoords=True, export_cameras=False, export_lights=False)
    # Keep the low-detail mesh out of studio rendering while exporting it above.
    lod.hide_render=True
    reference=bpy.data.images.load(str(ROOT/'docs/art/vehicles/2026-10-09'/concept))
    reference.pack()
    reference.use_fake_user=True
    bpy.context.scene['concept_reference']=concept
    bpy.context.scene.render.filepath=str(OUT/(name+'-preview.png'))
    bpy.context.scene.cycles.samples=16
    bpy.context.scene.render.resolution_percentage=65
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'-sedan.blend')))
    bpy.ops.render.render(write_still=True)
    reports.append({'name':name, 'concept':concept, 'paint_srgb':paint,
        'triangles':sum(len(o.data.polygons) for o in objects if o!=lod),
        'lod_triangles':len(lod.data.polygons) if name!='police' else None, 'glb_bytes':path.stat().st_size,
        'atlas_size':[SIZE,SIZE], 'shared_base':'player-sedan-v2',
        'beacon_colors':{'left':'red','right':'blue'} if name=='police' else None})
(OUT/'asset-report.json').write_text(json.dumps(reports,indent=2)+'\n',encoding='utf-8')
print('FAMILY_ASSET_REPORT '+json.dumps(reports))
