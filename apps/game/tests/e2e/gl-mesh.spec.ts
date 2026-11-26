import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import ts from 'typescript';
import type { GlMeshRenderer } from '../../src/presentation/gl-mesh';

function rendererScript(): string {
  return ts.transpileModule(
    readFileSync(new URL('../../src/presentation/gl-mesh.ts', import.meta.url), 'utf-8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
}

test('draws shared static meshes with Unity matrix columns and packed UVs', async ({ page }) => {
  const pixels = await page.evaluate(async (script) => {
    const out = {} as { GlMeshRenderer: typeof GlMeshRenderer };
    new Function('exports', script)(out);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const renderer = new out.GlMeshRenderer(canvas);
    const gl = canvas.getContext('webgl')!;
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const translate = (x: number) => [...identity.slice(0, 12), x, 0, 0, 1];
    const mesh = renderer.createMesh({
      vertices: [-0.3, -0.3, 0, 0.3, -0.3, 0, 0.3, 0.3, 0, -0.3, 0.3, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      colors: [0.8, 1, 0.6, 1, 0.8, 1, 0.6, 1, 0.8, 1, 0.6, 1, 0.8, 1, 0.6, 1],
      uv0: [0, 0, 1, 0, 1, 1, 0, 1],
      uv1: [0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0],
      texcoord1: new Float32Array(16).fill(0.25),
      texcoord2: new Float32Array(16).fill(0.25),
      indices: [0, 1, 2, 0, 2, 3],
    });
    const material = await renderer.createMaterial({
      vertexShader: `
        attribute vec3 in_POSITION0;
        attribute vec3 in_NORMAL0;
        attribute vec4 in_COLOR0, in_TEXCOORD0, in_TEXCOORD1, in_TEXCOORD2;
        uniform vec4 hlslcc_mtx4x4unity_ObjectToWorld[4];
        uniform vec4 hlslcc_mtx4x4unity_WorldToObject[4];
        uniform vec4 hlslcc_mtx4x4unity_MatrixVP[4];
        uniform vec4 _Time;
        uniform vec3 _WorldSpaceCameraPos;
        varying vec4 color;
        varying vec2 uv;
        void main() {
          vec4 world = hlslcc_mtx4x4unity_ObjectToWorld[0] * in_POSITION0.x
            + hlslcc_mtx4x4unity_ObjectToWorld[1] * in_POSITION0.y
            + hlslcc_mtx4x4unity_ObjectToWorld[2] * in_POSITION0.z
            + hlslcc_mtx4x4unity_ObjectToWorld[3];
          vec4 local = hlslcc_mtx4x4unity_WorldToObject[0] * world.x
            + hlslcc_mtx4x4unity_WorldToObject[3] * world.w;
          gl_Position = hlslcc_mtx4x4unity_MatrixVP[0] * world.x
            + hlslcc_mtx4x4unity_MatrixVP[1] * world.y
            + hlslcc_mtx4x4unity_MatrixVP[3] * world.w;
          float a = abs(local.x - in_POSITION0.x) < 0.001 ? 1.0 : 0.0;
          color = in_COLOR0 * vec4(_Time.y, in_NORMAL0.z, in_TEXCOORD0.z * _WorldSpaceCameraPos.y, a);
          uv = in_TEXCOORD0.xy + in_TEXCOORD1.xy + in_TEXCOORD2.xy;
        }`,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D _MainTex;
        uniform vec4 _Tint;
        uniform float _Gain;
        varying vec4 color;
        varying vec2 uv;
        void main() { gl_FragColor = texture2D(_MainTex, uv) * color * _Tint * _Gain; }`,
      uniforms: { _Tint: [1, 1, 1, 1], _Gain: 1 },
      textures: { _MainTex: 'white' },
    });
    const instance = {
      mesh, material, viewProjection: identity, time: [0, 1, 0, 0], cameraPosition: [0, 1, 0],
    };
    renderer.render([
      { ...instance, objectToWorld: translate(-0.5), worldToObject: translate(0.5), vertexColor: [0.5, 0.5, 1, 1] },
      { ...instance, objectToWorld: translate(0.5), worldToObject: translate(-0.5), vertexColor: [1, 0.25, 0, 1] },
    ]);
    const value = (x: number) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const result = { left: value(16), right: value(48), transparent: value(32), error: gl.getError() };
    renderer.dispose();
    return result;
  }, rendererScript());

  expect(pixels.left[0]).toBe(102);
  expect(pixels.left[1]).toBeGreaterThanOrEqual(127);
  expect(pixels.left[1]).toBeLessThanOrEqual(128);
  expect(pixels.left[2]).toBeGreaterThanOrEqual(76);
  expect(pixels.left[2]).toBeLessThanOrEqual(77);
  expect(pixels.left[3]).toBe(255);
  expect(pixels.right).toEqual([204, 64, 0, 255]);
  expect(pixels.transparent).toEqual([0, 0, 0, 0]);
  expect(pixels.error).toBe(0);
});

test('reports missing samplers, vertex inputs and uniforms explicitly', async ({ page }) => {
  const errors = await page.evaluate(async (script) => {
    const out = {} as { GlMeshRenderer: typeof GlMeshRenderer };
    new Function('exports', script)(out);
    const renderer = new out.GlMeshRenderer(document.createElement('canvas'));
    const mesh = renderer.createMesh({ vertices: [-1, -1, 0, 1, -1, 0, 0, 1, 0] });
    const vertex = 'attribute vec3 in_POSITION0; void main() { gl_Position = vec4(in_POSITION0, 1.0); }';
    const frag = 'precision mediump float; void main() { gl_FragColor = vec4(1.0); }';
    const missingSampler = await renderer.createMaterial({
      vertexShader: vertex,
      fragmentShader: 'precision mediump float; uniform sampler2D _Missing; void main() { gl_FragColor = texture2D(_Missing, vec2(0.0)); }',
    }).then(() => '', (error: Error) => error.message);
    const missingNormal = await renderer.createMaterial({
      vertexShader: 'attribute vec3 in_POSITION0, in_NORMAL0; void main() { gl_Position = vec4(in_POSITION0 + in_NORMAL0, 1.0); }',
      fragmentShader: frag,
    });
    const missingUniform = await renderer.createMaterial({
      vertexShader: vertex,
      fragmentShader: 'precision mediump float; uniform float _Missing; void main() { gl_FragColor = vec4(_Missing); }',
    });
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const attempt = (material: typeof missingNormal) => {
      try {
        renderer.render([{
          material, mesh, objectToWorld: identity, worldToObject: identity, viewProjection: identity,
          time: [0, 0, 0, 0], cameraPosition: [0, 0, 0],
        }]);
        return '';
      } catch (error) {
        return String(error);
      }
    };
    const result = { missingSampler, missingNormal: attempt(missingNormal), missingUniform: attempt(missingUniform) };
    renderer.dispose();
    return result;
  }, rendererScript());

  expect(errors.missingSampler).toContain('_Missing');
  expect(errors.missingNormal).toContain('in_NORMAL0');
  expect(errors.missingUniform).toContain('_Missing');
});

test('loads images with texture wrapping, honors blend factors and rejects NPOT repeat', async ({ page }) => {
  const outcome = await page.evaluate(async (script) => {
    const out = {} as { GlMeshRenderer: typeof GlMeshRenderer };
    new Function('exports', script)(out);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const renderer = new out.GlMeshRenderer(canvas);
    const gl = canvas.getContext('webgl')!;
    const vertexShader = `
      attribute vec3 in_POSITION0;
      attribute vec4 in_COLOR0;
      varying vec4 color;
      void main() { gl_Position = vec4(in_POSITION0, 1.0); color = in_COLOR0; }
    `;
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      varying vec4 color;
      void main() { gl_FragColor = texture2D(image, vec2(1.25, 0.25)) * color; }
    `;
    const bit = document.createElement('canvas');
    bit.width = 2;
    bit.height = 2;
    const bitmap = bit.getContext('2d')!;
    bitmap.fillStyle = '#00f';
    bitmap.fillRect(0, 0, 2, 1);
    bitmap.fillStyle = '#f00';
    bitmap.fillRect(0, 1, 1, 1);
    bitmap.fillStyle = '#0f0';
    bitmap.fillRect(1, 1, 1, 1);
    const tex = { url: bit.toDataURL(), filter: 'point' as const, wrapU: 'repeat' as const, wrapV: 'clamp' as const };
    const back = await renderer.createMaterial({ vertexShader, fragmentShader, textures: { image: tex } });
    const front = await renderer.createMaterial({
      vertexShader, fragmentShader, textures: { image: 'white' },
      blend: { src: gl.SRC_ALPHA, dst: gl.ONE_MINUS_SRC_ALPHA },
    });
    const mesh = renderer.createMesh({ vertices: [-1, -1, 0, 1, -1, 0, 0, 1, 0] });
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const transform = {
      mesh, objectToWorld: identity, worldToObject: identity, viewProjection: identity,
      time: [0, 0, 0, 0], cameraPosition: [0, 0, 0],
    };
    const center = () => {
      const pixel = new Uint8Array(4);
      gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const base = { ...transform, material: back, vertexColor: [1, 1, 1, 1] };
    renderer.render([base]);
    const wrapped = center();
    renderer.render([base, { ...transform, material: front, vertexColor: [0, 1, 0, 0.5] }]);
    const blended = center();
    bit.width = 3;
    const npotError = await renderer.createMaterial({
      vertexShader, fragmentShader, textures: { image: { ...tex, url: bit.toDataURL() } },
    }).then(() => '', (error: Error) => error.message);
    renderer.dispose();
    return { wrapped, blended, npotError };
  }, rendererScript());

  expect(outcome.wrapped).toEqual([255, 0, 0, 255]);
  for (const channel of outcome.blended.slice(0, 2)) {
    expect(channel).toBeGreaterThanOrEqual(127);
    expect(channel).toBeLessThanOrEqual(128);
  }
  expect(outcome.blended.slice(2)).toEqual([0, 191]);
  expect(outcome.npotError).toContain('non-power-of-two');
});
