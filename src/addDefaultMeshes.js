import * as THREE from 'three'

export const addDefaultMeshes = ({xPos =0, yPos = 0,zPos = 0}={}) =>{

    const geometry = new THREE.BoxGeometry(1,1,1)
    const material = new THREE.MeshBasicMaterial({color: 0xff0000})
    const mesh = new THREE.Mesh(geometry,material)
    mesh.position.set(xPos,yPos,zPos)
    return mesh
}

export const addSandardMesh = ({xPos =0, yPos = 0,zPos = 0}={})=>{
    const geometry = new THREE.BoxGeometry(1,1,1)
    const material = new THREE.MeshStandardMaterial({color: 0xff00ff})
    const mesh = new THREE.Mesh(geometry,material)
    mesh.position.set(xPos,yPos,zPos)
    return mesh
}