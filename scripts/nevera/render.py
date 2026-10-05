"""V2: photographic labels, hollow glass, real liquid and a fixed light rig.

Every instance is rendered at its final tray position with the same orthographic
camera. Crowns use 2x sampling and Pillow reduces them to the native 1.8px/mm
scale; bottle shoulders render at native resolution. Run with --all.
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from config import *
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser()
parser.add_argument('--all',action='store_true')
parser.add_argument('--python',default=os.environ.get('NEVERA_PYTHON','python'))
parser.add_argument('--samples',type=int,default=128)
parser.add_argument('--device',choices=['AUTO','CPU','CUDA'],default='AUTO')
parser.add_argument('--only',choices=['bandeja']+[p[0] for p in CAPS+BOTTLES])
parser.add_argument('--position',type=int,help='Render only this 1-based instance for material review')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
BUILD.mkdir(parents=True,exist_ok=True)
subprocess.run([args.python,str(ROOT/'postproceso.py'),'--prepare'],check=True)
DEVICE='CPU'
if args.device!='CPU':
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='CUDA'
        prefs.get_devices()
        for device in prefs.devices:
            device.use=device.type=='CUDA'
        if any(d.use for d in prefs.devices): DEVICE='GPU'
    except (RuntimeError,TypeError):
        if args.device=='CUDA': raise
(BUILD/'render-info.json').write_text(json.dumps({
    'blender':bpy.app.version_string,'samples':args.samples,'device':DEVICE,
    'supersampling':SPRITE_UPSCALE,'version':VERSION}),encoding='utf-8')

def rgba(color):
    values=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)+(1,)

def material(name,color,metallic=0,roughness=.25,transmission=0,ior=1.46):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    for key,value in [('Base Color',rgba(color)),('Metallic',metallic),
                      ('Roughness',roughness),('Transmission Weight',transmission),('IOR',ior)]:
        bsdf.inputs[key].default_value=value
    return mat

def absorption(mat,color,density):
    node=mat.node_tree.nodes.new('ShaderNodeVolumeAbsorption')
    node.inputs['Color'].default_value=rgba(color)
    node.inputs['Density'].default_value=density
    mat.node_tree.links.new(node.outputs[0],mat.node_tree.nodes.get('Material Output').inputs['Volume'])

def smooth(obj):
    for p in obj.data.polygons: p.use_smooth=True

def mesh_object(name,vertices,faces,mat):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    smooth(obj)
    return obj

def box(name,location,dimensions,mat,bevel=2):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    obj=bpy.context.object
    obj.name=name
    obj.dimensions=dimensions
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('machined fillet','BEVEL')
        mod.width=bevel
        mod.segments=8
        obj.modifiers.new('weighted normals','WEIGHTED_NORMAL')
    return obj

def cylinder(name,radius,depth,z,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=192,radius=radius,depth=depth,location=(0,0,z))
    obj=bpy.context.object
    obj.name=name
    obj.data.materials.append(mat)
    mod=obj.modifiers.new('rolled lip','BEVEL')
    mod.width=min(.6,depth/4)
    mod.segments=5
    obj.modifiers.new('weighted normals','WEIGHTED_NORMAL')
    return obj

def torus(name,radius,thickness,z,mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=thickness,
        major_segments=192,minor_segments=16,location=(0,0,z))
    obj=bpy.context.object
    obj.name=name
    obj.data.materials.append(mat)
    smooth(obj)
    return obj

def rounded_loop(w,h,r,z,steps=48):
    r=min(r,w/2,h/2)
    vertices=[]
    for cx,cy,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),
                        (-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
        for i in range(steps):
            a=math.radians(start+i*90/steps)
            vertices.append((cx+r*math.cos(a),cy+r*math.sin(a),z))
    return vertices

def profile_mesh(name,profiles,mat,hollow=False):
    n=192
    verts=[v for p in profiles for v in rounded_loop(*p)]
    faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)
        for k in range(len(profiles)-1) for i in range(n)]
    faces.append(tuple(reversed(range(n))))
    if hollow:
        inner=[(w-4.4,h-4.4,max(.1,r-2.2),z+(2.2 if k==0 else 0))
               for k,(w,h,r,z) in enumerate(profiles)]
        offset=len(verts)
        verts += [v for p in inner for v in rounded_loop(*p)]
        faces += [(offset+k*n+i,offset+(k+1)*n+i,offset+(k+1)*n+(i+1)%n,offset+k*n+(i+1)%n)
                  for k in range(len(inner)-1) for i in range(n)]
        faces.append(tuple(range(offset,offset+n)))
        a=(len(profiles)-1)*n
        b=offset+(len(profiles)-1)*n
        faces += [(a+i,a+(i+1)%n,b+(i+1)%n,b+i) for i in range(n)]
    else:
        faces.append(tuple(range((len(profiles)-1)*n,len(profiles)*n)))
    obj=mesh_object(name,verts,faces,mat)
    return obj

def photo_disk(slug,radius,z):
    path=ROOT/'texturas'/f'{slug}.png'
    if not path.exists(): path=BUILD/'provisionales'/f'{slug}.png'
    mat=material('photographic printed closure '+slug,'#ffffff',0,.42)
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value=.16
    bsdf.inputs['Coat Weight'].default_value=.04
    bsdf.inputs['Coat Roughness'].default_value=.3
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image=bpy.data.images.load(str(path),check_existing=True)
    mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    n=192
    # A single planar printed face prevents central fan/decal artifacts. Crown
    # dome, side-wall corrugations and rolled lip are separate dense geometry.
    verts=[(radius*math.cos(i*math.tau/n),radius*math.sin(i*math.tau/n),z+.5)
           for i in range(n)]
    faces=[tuple(range(n))]
    obj=mesh_object('printed cap face',verts,faces,mat)
    uv=obj.data.uv_layers.new()
    for face in obj.data.polygons:
        for li in face.loop_indices:
            co=obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv=(.5+co.x/(2*radius),.5+co.y/(2*radius))

def area(name,location,target,power,w,h,color):
    bpy.ops.object.light_add(type='AREA',location=location)
    obj=bpy.context.object
    obj.name=name
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    obj.data.shape='RECTANGLE'
    obj.data.size=w
    obj.data.size_y=h
    obj.data.energy=power
    obj.data.color=color

def reset(supersampling=1):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    # Each scene retains only its used materials; shared source image data stays.
    for mat in list(bpy.data.materials):
        if mat.users==0: bpy.data.materials.remove(mat)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'
    scene.unit_settings.scale_length=.001
    scene.render.engine='CYCLES'
    scene.cycles.device=DEVICE
    scene.cycles.samples=args.samples
    scene.cycles.use_denoising=True
    scene.cycles.use_adaptive_sampling=True
    scene.cycles.adaptive_threshold=.018
    scene.cycles.adaptive_min_samples=32
    scene.cycles.seed=1906
    scene.cycles.max_bounces=16
    scene.cycles.transmission_bounces=12
    scene.cycles.volume_bounces=2
    scene.render.resolution_x,scene.render.resolution_y=WIDTH,HEIGHT
    scene.render.resolution_percentage=100*supersampling
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=True
    scene.view_settings.view_transform='AgX'
    try: scene.view_settings.look='AgX - Medium High Contrast'
    except TypeError: pass
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.09,.11,.14,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
    bpy.ops.object.camera_add(location=(0,0,1600))
    scene.camera=bpy.context.object
    scene.camera.data.type='ORTHO'
    scene.camera.data.ortho_scale=HEIGHT/PX_PER_MM
    scene.camera.data.clip_end=5000
    area('cold refrigerator softbox',(-340,0,500),(-60,0,0),3_200_000,110,760,(.85,.94,1))
    area('right reflection strip',(350,70,430),(70,0,0),2_100_000,85,700,(1,.93,.84))
    area('soft overhead',(0,210,680),(0,0,0),3_200_000,490,340,(.95,.98,1))
    return scene

def steel_material():
    mat=material('anisotropic brushed stainless','#a7acae',.96,.22)
    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    bsdf.inputs['Anisotropic'].default_value=.5
    tex=nodes.new('ShaderNodeTexCoord')
    mapping=nodes.new('ShaderNodeVectorMath')
    mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(2800,9,12)
    noise=nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=1
    noise.inputs['Detail'].default_value=2
    links.new(tex.outputs['Generated'],mapping.inputs[0])
    links.new(mapping.outputs[0],noise.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value=.07
    bump.inputs['Distance'].default_value=.009
    links.new(noise.outputs['Fac'],bump.inputs['Height'])
    links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    rough=nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value=.17
    rough.inputs['To Max'].default_value=.26
    links.new(noise.outputs['Fac'],rough.inputs['Value'])
    links.new(rough.outputs['Result'],bsdf.inputs['Roughness'])
    return mat

def frame_ring(mat):
    profiles=[(592,825,24,-1),(596,829,25,13),(595,828,25,26),
        (590,823,24,31),(581,814,23,34),(570,803,22,33),
        (560,793,20,28),(552,785,19,18),(547,780,18,4),(545,778,18,-1)]
    n=192
    verts=[v for p in profiles for v in rounded_loop(*p)]
    faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)
        for k in range(len(profiles)-1) for i in range(n)]
    mesh_object('deep drawn rolled stainless rim',verts,faces,mat)

def xy(x,y): return ((x-WIDTH/2)/PX_PER_MM,(HEIGHT/2-y)/PX_PER_MM)

def render(scene,path):
    scene.render.filepath=str(path)
    try: bpy.ops.render.render(write_still=True)
    except RuntimeError:
        if scene.cycles.device!='GPU': raise
        print('GPU unavailable for this scene; retrying on CPU',flush=True)
        scene.cycles.device='CPU'
        bpy.ops.render.render(write_still=True)

def tray():
    scene=reset()
    steel=steel_material()
    dark=material('fridge outside shadow','#060b0e',.05,.6)
    box('outside',(0,0,-12),(615,850,8),dark,2)
    box('recessed steel floor',(0,0,-3),(559,795,8),steel,14)
    frame_ring(steel)
    for x in (240,438,636,834):
        xx,yy=xy(x,260)
        box('rolled cap divider',(xx,yy,16),(4,196,34),steel,1.6)
    xx,yy=xy(540,442)
    box('shelf rolled rail',(xx,yy,18),(552,9,38),steel,2.8)
    for x in (290,540,790):
        xx,yy=xy(x,936)
        box('polished bottle divider',(xx,yy,18),(8,550,38),steel,2.5)
    for y in (794,1114):
        xx,yy=xy(540,y)
        box('low bottle support',(xx,yy,5),(551,6,12),steel,2)
    scene.render.use_border=False
    render(scene,BUILD/'bandeja.png')

def bottle(slug,color,cap_color):
    is_pink=slug=='rosa-por-confirmar'
    if is_pink:
        body=material('glazed patterned shoulder','#e9a9bb',0,.18)
        bsdf=body.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Coat Weight'].default_value=.25
        tex=body.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image=bpy.data.images.load(str(ROOT/'texturas'/'rosa-hombro.png'),check_existing=True)
        body.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=192,ring_count=96,location=(0,0,21))
        obj=bpy.context.object
        obj.name='unbranded decorated shoulder'
        obj.scale=(54,54,24)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        obj.data.materials.append(body)
        for face in obj.data.polygons:
            for li in face.loop_indices:
                co=obj.data.vertices[obj.data.loops[li].vertex_index].co
                obj.data.uv_layers.active.data[li].uv=(.5+co.x/108,.5+co.y/108)
        smooth(obj)
    else:
        # Thin-wall transmission carries the actual amber/red/green glass tint.
        glass_base={'buen-amigo':'#f5dfb0','fireball':'#f5bcae',
                    'jagermeister':'#a4dcb4'}.get(slug,'#f7f3eb')
        glass=material('optical bottle glass',glass_base,0,.065,1,1.5)
        absorption(glass,color,.17 if slug=='jagermeister' else .018)
        profiles=[(100,145,14,2),(106,151,16,6),(107,152,17,10),
                  (103,148,17,14),(104,150,17,18),(99,143,18,23),
                  (93,134,20,29),(83,120,22,35),(70,94,25,41),(56,58,27,47)]
        profile_mesh('2.2mm hollow moulded glass shoulder',profiles,glass,hollow=True)
        spirit=material('transparent spirit','#fffaf0',0,.035,1,1.36)
        tint={'buen-amigo':'#e3a23b','fireball':'#be270c','jagermeister':'#ad742d'}.get(slug,color)
        absorption(spirit,tint,.065 if slug!='jagermeister' else .035)
        liquid_profiles=[(w-6,h-6,max(1,r-3),z+1) for w,h,r,z in profiles[:8]]
        profile_mesh('visible contained liquid',liquid_profiles,spirit)
        cylinder('short glass neck',29,10,44,glass)
    cap_radius=28.5 if is_pink else 31
    side_color='#131713' if slug=='jagermeister' else cap_color
    top=material('fine closure knurling',side_color,.07,.22)
    cylinder('closure side wall',cap_radius,11,52,top)
    for i in range(80):
        a=i*math.tau/80
        box('fine closure grip',(cap_radius*math.cos(a),cap_radius*math.sin(a),52),
            (.65,.65,7.5),top,.23)
    torus('closure sealing lip',cap_radius-.6,.55,57.6,top)
    photo_disk(slug,cap_radius-1.4,57.8)

def crown(slug,color,cap_color):
    enamel=material('pressed crown enamel',cap_color,.13,.23)
    metal=material('exposed rolled metal','#9b9b98',.92,.19)
    n=21*24
    profiles=[(23.0,1.0,.70),(23.1,1.6,1.0),(22.8,2.2,.95),
              (22.4,3.7,.80),(22,5.2,.55),(21.5,6.4,.25),(21.2,7.6,.05)]
    verts=[]
    for radius,z,amplitude in profiles:
        for i in range(n):
            a=i*math.tau/n
            r=radius+amplitude*(.5+.5*math.cos(21*a))
            verts.append((r*math.cos(a),r*math.sin(a),z))
    faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)
           for k in range(len(profiles)-1) for i in range(n)]
    mesh_object('21 folded teeth with rounded corrugation',verts,faces,enamel)
    cylinder('domed crown face',21.2,1.4,7.4,enamel)
    torus('exposed thin rolled lip',23.15,.22,1.25,metal)
    photo_disk(slug,21.05,8.1)

def sprite(product,kind,slot,position_index):
    scene=reset(SPRITE_UPSCALE[kind])
    floor=material('contact catcher brushed steel','#a7acae',.7,.25)
    catcher=box('contact shadow and reflection catcher',(0,0,-3),(2000,2000,6),floor,0)
    catcher.is_shadow_catcher=True
    before=set(bpy.context.scene.objects)
    (bottle if kind=='botellas' else crown)(*product)
    objects=set(bpy.context.scene.objects)-before
    cx,cy=POSITIONS[kind][position_index]
    cx+=slot['pixels']['x']
    cy+=slot['pixels']['y']
    xx,yy=xy(cx,cy)
    bpy.ops.object.empty_add()
    parent=bpy.context.object
    parent.name='placed product'
    for obj in objects: obj.parent=parent
    parent.location=(xx,yy,0)
    if kind=='chapas': parent.rotation_euler.z=[0,-.035,.055,.025,-.045][position_index]
    w,h=SPRITE_SIZES[kind]
    x,y=cx-w//2,cy-h//2
    scene.render.use_border=True
    scene.render.use_crop_to_border=True
    # Fixed camera and frame; each border is on the final background grid.
    scene.render.border_min_x=(x+.125)/WIDTH
    scene.render.border_max_x=(x+w+.125)/WIDTH
    scene.render.border_min_y=(HEIGHT-y-h+.125)/HEIGHT
    scene.render.border_max_y=(HEIGHT-y+.125)/HEIGHT
    render(scene,BUILD/f'{product[0]}-pos{position_index+1}.png')

if not args.only or args.only=='bandeja': tray()
for kind,products in [('chapas',CAPS),('botellas',BOTTLES)]:
    for product in products:
        if args.only and args.only!=product[0]: continue
        slot=next(s for s in SLOTS if s['slug']==product[0])
        for i in range(slot['capacidad']):
            if args.position and args.position!=i+1: continue
            sprite(product,kind,slot,i)
if args.all:
    if args.position: raise ValueError('--position is only for isolated material review; omit --all')
    command=[args.python,str(ROOT/'postproceso.py')]
    if args.only: command+=['--only',args.only]
    subprocess.run(command,check=True)
