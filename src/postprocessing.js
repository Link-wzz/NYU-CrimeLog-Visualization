import { EffectComposer, RenderPass, RenderPixelatedPass } from "three/examples/jsm/Addons.js";
import AfterImageNode from "three/examples/jsm/tsl/display/AfterImageNode.js";

export function postprocessing(scene,camera,renderer, mesh){
    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    composer.setSize(window.innerWidth, window.innerHeight)

    const renderPass = new RenderPass (scene, camera)
    composer.addPass(renderPass)

    const pixelPass = new RenderPixelatedPass(6,scene,camera)
    composer.addPass(pixelPass)

      const glitchPass = new GlitchPass()
  glitchPass.enabled = true
  composer.addPass(glitchPass)

  const afterPass = new AfterimagePass()
  afterPass.uniforms.damp.value = 0.96
  afterPass.damp = 0
  composer.addPass(afterPass)
    return {composer: composer,pixel: pixelPass}


    
}