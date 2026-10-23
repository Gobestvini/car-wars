import { createTrafficAssets, makeTrafficCar } from './vehicle-visuals.js';

// Rendering is injected into the data-only runtime; Node never imports this file.
export function createTrafficVisualAdapter(scene, THREE) {
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere(new THREE.Vector3(),3.2);
  const a=new THREE.Quaternion(),b=new THREE.Quaternion();let hasCamera=false;
  return {
    assets:()=>createTrafficAssets(THREE),
    create:(assets,index,role)=>makeTrafficCar(THREE,assets,index,role),
    add:mesh=>scene.add(mesh),remove:mesh=>scene.remove(mesh),
    wrapAppearance(mesh){
      const visual=new THREE.Group();visual.name='Vehicle appearance visual';
      visual.add(...[...mesh.children]);mesh.add(visual);mesh.userData.appearanceVisual=visual;
    },
    sync(state,t){
      const body=state.simulation.body,mesh=state.mesh;if(!mesh)return;
      mesh.position.set(body.previousPosition.x+(body.position.x-body.previousPosition.x)*t,
        body.previousPosition.y+(body.position.y-body.previousPosition.y)*t-.96,
        body.previousPosition.z+(body.position.z-body.previousPosition.z)*t);
      a.set(body.previousQuaternion.x,body.previousQuaternion.y,body.previousQuaternion.z,body.previousQuaternion.w);
      b.set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
      mesh.quaternion.copy(a.slerp(b,t));
    },
    beginFrame(camera){hasCamera=Boolean(camera);if(camera)frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));},
    visible(state){sphere.radius=state.role==='police'?6:3.2;sphere.center.set(state.x,1,state.z);return !hasCamera||frustum.intersectsSphere(sphere);},
  };
}
