"""Smooth geometry and steel materials shared in style with Chupitería."""
import math
import bpy
from mathutils import Vector

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
