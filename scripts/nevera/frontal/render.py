"""Cycles frontal refrigerator, actual 3D bottles/cans/crowns, fixed camera."""
import argparse
import sys
import json
import math
import subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from config import *
import bpy
from mathutils import Vector
from geometria import *

parser=argparse.ArgumentParser()
parser.add_argument('--all',action='store_true')
parser.add_argument('--python',default='python')
parser.add_argument('--only',choices=['bandeja']+[g['id'] for g in GROUPS])
parser.add_argument('--position',type=int)
parser.add_argument('--masks-only',action='store_true',help='Rebuild geometry masks without repeating product shading')
parser.add_argument('--samples',type=int,default=128)
parser.add_argument('--device',choices=['AUTO','CUDA','CPU'],default='AUTO')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
BUILD.mkdir(exist_ok=True)
subprocess.run([args.python,str(ROOT/'preparar_texturas.py')],check=True)
DEVICE='CPU'
if args.device!='CPU':
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='CUDA';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='CUDA'
    if any(d.use for d in prefs.devices):DEVICE='GPU'
if not args.masks_only:
    (BUILD/'render-info.json').write_text(json.dumps(dict(blender=bpy.app.version_string,muestras=args.samples,dispositivo=DEVICE)),encoding='utf-8')

def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials):
        if not m.users:bpy.data.materials.remove(m)
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device=DEVICE
    s.cycles.samples=args.samples;s.cycles.use_adaptive_sampling=True
    s.cycles.adaptive_threshold=.02;s.cycles.adaptive_min_samples=32
    s.cycles.use_denoising=True;s.cycles.max_bounces=16;s.cycles.transmission_bounces=12;s.cycles.volume_bounces=2;s.cycles.seed=1906
    s.render.resolution_x=WIDTH;s.render.resolution_y=HEIGHT;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
    s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
    s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.09,.11,.14,1)
    s.world.node_tree.nodes['Background'].inputs[1].default_value=.45
    bpy.ops.object.camera_add(location=(0,-1800,0));s.camera=bpy.context.object
    s.camera.rotation_euler=(Vector((0,0,0))-s.camera.location).to_track_quat('-Z','Y').to_euler()
    s.camera.data.type='ORTHO';s.camera.data.ortho_scale=HEIGHT/PX_PER_MM;s.camera.data.clip_end=5000
    area('cold left strip',(-360,-460,70),(-50,0,0),2_400_000,110,790,(.86,.94,1))
    area('warm right strip',(355,-430,100),(60,0,0),1_750_000,100,740,(1,.95,.88))
    area('broad upper light',(0,-420,420),(0,0,60),2_600_000,490,300,(.96,.98,1))
    return s

def render(s,path):
    s.render.filepath=str(path)
    try:bpy.ops.render.render(write_still=True)
    except RuntimeError:
        if s.cycles.device!='GPU':raise
        s.cycles.device='CPU';bpy.ops.render.render(write_still=True)

def lathe(name,profile,mat,hollow=0,segments=256):
    # Bottle/can vertical axis Z. Fully smooth rotational surface.
    verts=[(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z) for r,z in profile for i in range(segments)]
    n=segments;faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(profile)-1) for i in range(n)]
    faces.append(tuple(reversed(range(n))))
    if hollow:
        offset=len(verts)
        inner=[(max(.1,r-hollow),z+(hollow if k==0 else 0)) for k,(r,z) in enumerate(profile)]
        verts.extend((r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in inner for i in range(n))
        faces.extend((offset+k*n+i,offset+(k+1)*n+i,offset+(k+1)*n+(i+1)%n,offset+k*n+(i+1)%n) for k in range(len(inner)-1) for i in range(n))
        faces.append(tuple(range(offset,offset+n)))
        a=(len(profile)-1)*n;b=offset+a
        faces.extend((a+i,a+(i+1)%n,b+(i+1)%n,b+i) for i in range(n))
    else:faces.append(tuple(range((len(profile)-1)*n,len(profile)*n)))
    return mesh_object(name,verts,faces,mat)

def printed(name):
    mat=material('reference printed '+name,'#ffffff',0,.43)
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'texturas'/f'{name}.png'),check_existing=True)
    bsdf=nodes.get('Principled BSDF');bsdf.inputs['Specular IOR Level'].default_value=.16
    links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    # Physically transparent regions of label artwork.
    links.new(tex.outputs['Alpha'],bsdf.inputs['Alpha'])
    return mat

def label(name,radius,width,zmin,zmax):
    mat=printed(name);steps=96
    # Cylindrical front label with projected UV, preserves actual lettering.
    half=math.asin(min(.985,width/(2*radius)))
    verts=[]
    for z in (zmin,zmax):
        for i in range(steps+1):
            a=-half+2*half*i/steps
            verts.append((radius*math.sin(a),-radius*math.cos(a),z))
    faces=[(i,i+1,steps+2+i,steps+1+i) for i in range(steps)]
    obj=mesh_object('curved label '+name,verts,faces,mat);uv=obj.data.uv_layers.new()
    projected=radius*math.sin(half)
    for f in obj.data.polygons:
        for li in f.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv=(.5+v.x/(2*projected),(v.z-zmin)/(zmax-zmin))

def water():
    pet=material('clear moulded PET','#e4edf2',0,.09,1,1.46)
    liquid=material('clear mineral water','#edf7fb',0,.025,1,1.333)
    # Rounded petaloid base, grip rings and shoulder taper.
    profile=[(19,1),(29,3),(33,9),(34,20),(33,28),(34,35),(32,40),(34,44),
        (33,50),(34,56),(32,62),(34,69),(33,77),(34,84),(33,91),(34,99),
        (34,123),(34,136),(33,143),(31,151),(28,161),(23,171),(18,180),(15.5,183),(15.5,194)]
    lathe('transparent hollow ribbed PET',profile,pet,.7)
    lathe('mineral water',[(18,2),(28,4),(32,10),(32.3,142),(30,151),(25,162),(21,170)],liquid)
    cap=material('neutral bottle closure','#d7e3ed',0,.23)
    cylinder('red screw closure',17,18,191,cap)
    for i in range(88):
        a=i*math.tau/88
        box('fine closure rib',(17*math.cos(a),17*math.sin(a),191),(.55,.55,14),cap,.15)
    torus('red tamper band',16.7,.9,181.3,cap)
    torus('PET neck support ring',16.3,.9,178,pet)
    # Neutral PET without a brand until the actual water is confirmed.
    for i in range(5):
        a=i*math.tau/5
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,radius=1,location=(19*math.cos(a),19*math.sin(a),7))
        o=bpy.context.object;o.name='rounded petaloid bottle foot';o.scale=(12,12,7);o.data.materials.append(pet);smooth(o)

def can(sugarfree=False):
    aluminum=material('brushed aluminum ends','#c0c4c8',.9,.2)
    blue=material('printed can','#75c9e8' if sugarfree else '#082b9d',.42,.24)
    lathe('slim drawn aluminum can',[(24,1),(28,3),(29,7),(29,159),(28,165),(26,169)],blue)
    label('red-bull-sugarfree-estampado' if sugarfree else 'red-bull-estampado',29.15,57.7,9,164)
    cylinder('can top',26.2,1.7,168,aluminum)
    torus('rolled top seam',27,.8,169,aluminum);torus('rolled bottom seam',27.5,.85,3,aluminum)
    torus('base stamped foot',24,.6,1.1,aluminum)
    tab=box('pull tab',(0,-3,170),(10,18,1.4),aluminum,4)
    dark=material('tab opening dark metal','#2b3035',.8,.28)
    box('ring pull opening',(0,-4,170.8),(4.5,7,.7),dark,1.8)

def beer():
    glass=material('amber hollow bottle glass','#e3c081',0,.1,1,1.5)
    absorption(glass,'#c18c33',.018)
    liquid=material('golden beer','#edbb54',0,.04,1,1.36);absorption(liquid,'#d6a745',.015)
    profile=[(26,1),(36,3),(43,8),(46,17),(46,135),(45,151),(42,165),(36,180),
        (30,193),(25,207),(22,224),(21,239),(20,263),(19,278),(19,290)]
    lathe('moulded amber longneck glass',profile,glass,2.1)
    lathe('beer fill',[(26,3),(35,5),(42,10),(43,153),(38,175),(29,196),(21,218),(18,266)],liquid)
    black=material('black crown enamel','#111414',.22,.26)
    cylinder('crown top',20.3,6,288,black)
    for i in range(21):
        a=i*math.tau/21
        box('21 folded closure teeth',(20*math.cos(a),20*math.sin(a),286),(2.4,2.4,5.5),black,.8)
    torus('glass base rim',43,1.1,8,glass)
    label('estrella-etiqueta',46.3,91.4,35,145)
    label('estrella-cuello',21.35,42,205,267)

def crown():
    enamel=material('green Heineken crown','#074e2d',.22,.27)
    steel=material('exposed crown lip','#a0a6a3',.9,.22)
    n=21*20;profiles=[(29,0,1),(29,1.3,1),(28.3,3.3,.8),(27.4,5.7,.4),(26.8,7.4,0)]
    vertices=[((r+a*(.5+.5*math.cos(21*t)))*math.cos(t),(r+a*(.5+.5*math.cos(21*t)))*math.sin(t),z)
              for r,z,a in profiles for t in [i*math.tau/n for i in range(n)]]
    faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(profiles)-1) for i in range(n)]
    mesh_object('dense folded crown teeth',vertices,faces,enamel)
    cylinder('crown face',26.9,1.2,7.3,enamel);torus('rolled steel lip',29,.35,1,steel)
    mat=printed('heineken-tapa');count=192;r=26.4
    obj=mesh_object('photo print Heineken',[(r*math.cos(i*math.tau/count),r*math.sin(i*math.tau/count),8.1) for i in range(count)],[tuple(range(count))],mat)
    uv=obj.data.uv_layers.new()
    for f in obj.data.polygons:
        for li in f.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co;uv.data[li].uv=(.5+v.x/(2*r),.5+v.y/(2*r))

def tray():
    s=reset();steel=steel_material();dark=material('outside cabinet','#080f13',.1,.42)
    box('outside cabinet',(0,100,0),(590,20,792),dark,24)
    box('recessed stainless back',(0,84,0),(536,14,747),steel,17)
    profiles=[(562,776,30,90),(579,793,34,78),(576,790,33,53),(568,782,31,45),
              (556,770,30,43),(540,754,26,50),(526,740,24,67),(522,736,23,85)]
    verts=[]
    for w,h,r,depth in profiles:
        verts.extend((x,depth,z) for x,z,_ in rounded_loop(w,h,r,0))
    n=192;faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(profiles)-1) for i in range(n)]
    mesh_object('deep drawn rolled steel cabinet rim',verts,faces,steel)
    for y in (536,725):
        z=(HEIGHT/2-y)/PX_PER_MM
        box('horizontal rolled shelf rail',(0,42,z),(515,28,14),steel,2.5)
        box('deep shelf ledge',(0,65,z-5),(515,52,5),steel,1.5)
    render(s,BUILD/'bandeja.png')

def sprite(group,index):
    s=reset();before=set(bpy.context.scene.objects)
    {'agua-cabreiroa-33-cl':water,'red-bull':can,'red-bull-sugarfree':lambda:can(True),'heineken':crown,'estrella-galicia':beer}[group['id']]()
    objects=set(bpy.context.scene.objects)-before
    bpy.ops.object.empty_add();parent=bpy.context.object
    for o in objects:o.parent=parent
    if group['id']=='heineken':
        parent.rotation_euler.x=math.pi/2
        parent.location=((group['centros'][index]-WIDTH/2)/PX_PER_MM,0,(HEIGHT/2-(group['base']-65))/PX_PER_MM)
    else:
        parent.location=((group['centros'][index]-WIDTH/2)/PX_PER_MM,0,(HEIGHT/2-group['base'])/PX_PER_MM)
    w,h=group['size'];x=group['centros'][index]-w//2;y=group['base']-h+10 if group['id']!='heineken' else group['base']-h
    # Contact catcher behind the objects, matching the cabinet back plane.
    catcher=box('contact shadow catcher',(0,84,0),(2000,1,2000),steel_material(),0);catcher.is_shadow_catcher=True
    s.render.use_border=True;s.render.use_crop_to_border=True
    s.render.border_min_x=(x+.125)/WIDTH;s.render.border_max_x=(x+w+.125)/WIDTH
    s.render.border_min_y=(HEIGHT-y-h+.125)/HEIGHT;s.render.border_max_y=(HEIGHT-y+.125)/HEIGHT
    if not args.masks_only:render(s,BUILD/f'{group["id"]}-{index+1}.png')
    # Dedicated opaque geometry mask: catcher opacity can exceed 128 around
    # nearby reflections, so its alpha must never define a selection outline.
    catcher.hide_render=True
    mat=bpy.data.materials.new('opaque silhouette');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear()
    emission=nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(1,1,1,1)
    output=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
    for obj in objects:
        if obj.type=='MESH':obj.data.materials.clear();obj.data.materials.append(mat)
    s.cycles.samples=16;s.cycles.use_adaptive_sampling=False;s.cycles.use_denoising=False;s.cycles.max_bounces=1
    render(s,BUILD/f'{group["id"]}-{index+1}-mascara.png')

if args.only in (None,'bandeja') and not args.masks_only:tray()
for group in GROUPS:
    if group.get('silueta'):continue
    if args.only and args.only!=group['id']:continue
    for i in range(group['cantidad']):
        if args.position and args.position!=i+1:continue
        sprite(group,i)
if args.all:
    if args.position:raise ValueError('Do not combine --all and --position')
    subprocess.run([args.python,str(ROOT/'postproceso.py')],check=True)
