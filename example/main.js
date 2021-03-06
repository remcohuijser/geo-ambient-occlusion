"use strict";


const REGL = require('regl');
const mat4 = require('gl-matrix').mat4;
const Trackball = require('trackball-controller');
const center = require('geo-center');
const transform = require('geo-3d-transform-mat4');
const box = require('geo-3d-box');
const mergeMeshes = require('merge-meshes');
const dragon = require('stanford-dragon/2');

const geoao = require('../index.js');


// Entry point.
main();


async function main() {

  // Grab our canvas and set the resolution to the window resolution.
  const canvas = document.getElementById('render-canvas');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // Create our regl context. Since we'll be passing this to geo-ambient-occlusion, we'll need A) OES_texture_float
  // because geo-ambient-occlusion always requires it, and B) OES_element_index_uint because our mesh has more than
  // 65536 vertices.
  const regl = REGL({
    canvas: canvas,
    extensions: ['OES_texture_float', 'OES_element_index_uint'],
  });

  // Center the dragon vertices on the origin.
  text('Centering dragon...');
  await display();
  dragon.positions = center(dragon.positions);

  // Create a floor to set the dragon model on. We'll need enough vertices on the top to capture the per-vertex
  // ambient occlusion.
  const floor = box({
    size: [128, 8, 64],
    segments:[128, 1, 128]
  });

  // Shift the floor to the feet of the dragon.
  let miny = Infinity;
  for (let v of dragon.positions) {
    miny = Math.min(v[1], miny);
  }
  miny -= 3.8;
  floor.positions = transform(floor.positions, mat4.translate([], mat4.create(), [0, miny, 0]));

  // Merge the two meshes into one.
  const mesh = mergeMeshes([floor, dragon]);

  // Initialize geo-ambient-occlusion.
  text('Initializing ambient occlusion generator...');
  await display();
  const aoSampler = geoao(mesh.positions, {
    cells: mesh.cells,
    resolution: 512,
    regl: regl,
  });

  // Sample the ambient occlusion. Every tenth of a second, give a progress update.
  text('Calculating ambient occlusion...');
  await display();
  const samples = 512;
  let t0 = performance.now();
  for (let i = 0; i < samples; i++) {
    aoSampler.sample();
    if (performance.now() - t0 > 100) {
      fraction(i/samples);
      await display();
      t0 = performance.now();
    }
  }

  // We're done with the progress bar, hide it.
  fraction(0);

  // Collect the results of the ambient occluseion. This is a Float32Array of length <number of vertices>.
  text('Collecting ambient occlusion...');
  await display();
  const ao = aoSampler.report();

  // Dispose of resources we no longer need.
  aoSampler.dispose();

  // Create a regl command for rendering the dragon. Note that we subtract the occlusion value from 1.0 in order to
  // calculate the ambient light.
  const render = regl({
    vert: `
      precision highp float;
      attribute vec3 position;
      attribute vec3 normal;
      attribute float occlusion;
      uniform mat4 model, view, projection;
      varying float vOcclusion;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vOcclusion = occlusion;
      }
    `,
    frag: `
      precision highp float;
      varying float vOcclusion;
      void main() {
        gl_FragColor = vec4(vec3(1.0 - vOcclusion) * vec3(0.95,0.95,0.95), 1.0);
      }
    `,
    attributes: {
      position: mesh.positions,
      occlusion: ao,
    },
    uniforms: {
      model: regl.prop('model'),
      view: regl.prop('view'),
      projection: regl.prop('projection'),
    },
    viewport: regl.prop('viewport'),
    elements: mesh.cells,
    cull: {
      enable: true,
      face: 'back',
    },
  });

  // Create a trackball.
  var trackball = new Trackball(canvas, {
    onRotate: loop,
    drag: 0.01
  });
  trackball.spin(13,0);

  // Handle mousewheel zoom.
  let zoom = 192;
  window.addEventListener('wheel', function(e) {
    if (e.deltaY < 0) {
      zoom *= 0.9;
    } else if (e.deltaY > 0) {
      zoom *= 1.1;
    }
    zoom = Math.max(10, Math.min(512, zoom));
    loop();
  })

  // Render loop.
  function loop() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const model = trackball.rotation;
    const view = mat4.lookAt([], [0,0,zoom], [0,0,0], [0,1,0]);
    const projection = mat4.perspective([], Math.PI/4, canvas.width/canvas.height, 0.1, 1000);

    regl.clear({
      color: [1,1,1,1],
      depth: 1,
    });

    render({
      model: model,
      view: view,
      projection: projection,
      viewport: {x: 0, y: 0, width: canvas.width, height: canvas.height},
    });
  }

  text('Click & drag to rotate the scene. Mousewheel zooms.');
  await display();

}


// Async utility function for updating the display.
function display() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}


// Update the progress bar.
function fraction(f) {
  document.getElementById('fraction').style.width = 100 * f + '%';
}


// Update the text field.
function text(value) {
  document.getElementById('fraction-label').innerHTML = value;
}
