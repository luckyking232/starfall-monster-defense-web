type Numbers = ArrayLike<number>;
type UniformValue = number | Numbers;
type TextureWrap = 'clamp' | 'repeat' | 'mirror';

export type GlMeshTexture = 'white' | 'black' | {
  url: string;
  filter: 'point' | 'bilinear';
  wrapU: TextureWrap;
  wrapV: TextureWrap;
};

export interface GlMeshData {
  vertices: Numbers;
  normals?: Numbers;
  colors?: Numbers;
  uv0?: Numbers;
  uv1?: Numbers;
  texcoord1?: Numbers;
  texcoord2?: Numbers;
  indices?: Numbers;
}

export interface GlMeshMaterial {
  vertexShader: string;
  fragmentShader: string;
  uniforms?: Readonly<Record<string, UniformValue>>;
  textures?: Readonly<Record<string, GlMeshTexture>>;
  /** The WebGL GLenum factors passed directly to blendFunc. */
  blend?: { src: number; dst: number };
  cull?: 'front' | 'back';
}

export interface GlMesh {
  readonly vertexCount: number;
}

export interface GlMeshMaterialHandle {
  readonly attributes: readonly string[];
}

export interface GlMeshInstance {
  mesh: GlMesh;
  material: GlMeshMaterialHandle;
  /** Unity-compatible column-major matrices. */
  objectToWorld: Numbers;
  worldToObject: Numbers;
  viewProjection: Numbers;
  time: Numbers;
  cameraPosition: Numbers;
  /** Modulates per-vertex colors, or supplies COLOR0 if there is no color buffer. */
  vertexColor?: Numbers;
  uvRect?: readonly [number, number, number, number];
  custom1?: Numbers;
  uniforms?: Readonly<Record<string, UniformValue>>;
}

interface VertexBuffer {
  buffer: WebGLBuffer;
  components: number;
}

interface MeshBuffers {
  attributes: Map<string, VertexBuffer>;
  indices?: { buffer: WebGLBuffer; count: number; type: number };
  colors?: Float32Array<ArrayBuffer>;
  tinted?: { buffer: WebGLBuffer; values: Float32Array<ArrayBuffer> };
  uv?: Float32Array<ArrayBuffer>;
  sheet?: { buffer: WebGLBuffer; values: Float32Array<ArrayBuffer> };
}

interface ShaderUniform extends WebGLActiveInfo {
  location: WebGLUniformLocation;
}

interface ShaderAttribute {
  name: string;
  location: number;
  components: number;
}

interface MaterialProgram {
  program: WebGLProgram;
  attributes: ShaderAttribute[];
  uniforms: ShaderUniform[];
  textures: { uniform: ShaderUniform; texture: WebGLTexture }[];
  material: GlMeshMaterial;
}

const attributeNames = new Set([
  'in_POSITION0', 'in_NORMAL0', 'in_COLOR0', 'in_TEXCOORD0', 'in_TEXCOORD1', 'in_TEXCOORD2',
]);

function floats(value: Numbers, length: number, label: string): Float32Array<ArrayBuffer> {
  if (value.length !== length) throw new RangeError(`${label} requires ${length} values.`);
  const data = Float32Array.from(value);
  if (!data.every(Number.isFinite)) throw new RangeError(`${label} contains a non-finite float.`);
  return data;
}

function linkProgram(gl: WebGLRenderingContext, { vertexShader, fragmentShader }: GlMeshMaterial): WebGLProgram {
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  if (!program) throw new Error('Cannot allocate a WebGL program.');
  try {
    for (const [kind, source, label] of [
      [gl.VERTEX_SHADER, vertexShader, 'Vertex'],
      [gl.FRAGMENT_SHADER, fragmentShader, 'Fragment'],
    ] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error(`Cannot allocate the ${label.toLowerCase()} shader.`);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`${label} shader compilation failed. ${gl.getShaderInfoLog(shader) ?? ''}`);
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed. ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    for (const shader of shaders) gl.detachShader(program, shader);
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

function attributeComponents(gl: WebGLRenderingContext, type: number): number {
  switch (type) {
    case gl.FLOAT: return 1;
    case gl.FLOAT_VEC2: return 2;
    case gl.FLOAT_VEC3: return 3;
    case gl.FLOAT_VEC4: return 4;
    default: return 0;
  }
}

function reflectProgram(gl: WebGLRenderingContext, program: WebGLProgram) {
  const attributes: ShaderAttribute[] = [];
  const uniforms: ShaderUniform[] = [];
  const attributeCount = Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES));
  for (let i = 0; i < attributeCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    if (!info) throw new Error('Could not read a shader attribute.');
    const components = attributeComponents(gl, info.type);
    if (!attributeNames.has(info.name) || !components || info.size !== 1) {
      throw new Error(`Unsupported shader attribute ${info.name}.`);
    }
    const location = gl.getAttribLocation(program, info.name);
    if (location < 0) throw new Error(`Missing location for attribute ${info.name}.`);
    attributes.push({ name: info.name, location, components });
  }
  const uniformCount = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) throw new Error('Could not read a shader uniform.');
    const location = gl.getUniformLocation(program, info.name);
    if (location === null) throw new Error(`Missing location for uniform ${info.name}.`);
    uniforms.push({ name: info.name.replace(/\[0\]$/, ''), size: info.size, type: info.type, location });
  }
  return { attributes, uniforms };
}

// Frames and effect textures share the same burst of requests when the chooser opens.
const imageLoads = new Map<string,Promise<HTMLImageElement>>();
const imageQueue: (() => void)[] = [];
const maxImageRequests = 8;
let activeImageRequests = 0;

async function readBattleImage(url: string): Promise<HTMLImageElement> {
  if (activeImageRequests < maxImageRequests) activeImageRequests++;
  else await new Promise<void>(resume => imageQueue.push(resume));
  try {
    let failure: unknown;
    for (const delay of [0,250,1000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve,delay));
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
      try {
        await image.decode();
        return image;
      } catch (error) {
        failure = error;
      }
    }
    throw new Error(`无法读取战场贴图 ${url}`,{cause:failure});
  } finally {
    const next = imageQueue.shift();
    if (next) next();
    else activeImageRequests--;
  }
}

export function loadBattleImage(url: string): Promise<HTMLImageElement> {
  const cached = imageLoads.get(url);
  if (cached) return cached;
  const pending = readBattleImage(url).catch(error => {
    imageLoads.delete(url);
    throw error;
  });
  imageLoads.set(url,pending);
  return pending;
}

function textureWrap(gl: WebGLRenderingContext, wrap: TextureWrap): number {
  switch (wrap) {
    case 'clamp': return gl.CLAMP_TO_EDGE;
    case 'repeat': return gl.REPEAT;
    case 'mirror': return gl.MIRRORED_REPEAT;
    default: throw new RangeError(`Unsupported texture wrap ${wrap}.`);
  }
}

function powerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function uploadTexture(
  gl: WebGLRenderingContext,
  input: GlMeshTexture,
  image: HTMLImageElement | null,
  label: string,
  repackRepeat: boolean,
): WebGLTexture {
  const solid = typeof input === 'string';
  if (solid && input !== 'white' && input !== 'black') {
    throw new Error(`Unsupported solid texture for ${label}.`);
  }
  if (!solid && input.filter !== 'point' && input.filter !== 'bilinear') {
    throw new Error(`Unsupported filter for texture ${label}.`);
  }
  if (!solid && !image) throw new Error(`Missing image for texture ${label}.`);
  const repeatedNpot = !solid && image && !(powerOfTwo(image.naturalWidth) && powerOfTwo(image.naturalHeight)) &&
    (input.wrapU !== 'clamp' || input.wrapV !== 'clamp');
  if (repeatedNpot && !repackRepeat) {
    throw new Error(`WebGL1 texture ${label} must use clamp for non-power-of-two dimensions.`);
  }
  const texture = gl.createTexture();
  if (!texture) throw new Error(`Cannot allocate texture ${label}.`);
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (image) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      let pixels: HTMLImageElement | HTMLCanvasElement = image;
      if (repeatedNpot && !solid) {
        // GLES supports the source wrap for these point-filtered NPOT textures.
        // Repack the upload to sample the same normalized UVs using WebGL 1.
        const surface = document.createElement('canvas');
        surface.width = 2 ** Math.ceil(Math.log2(image.naturalWidth));
        surface.height = 2 ** Math.ceil(Math.log2(image.naturalHeight));
        const context = surface.getContext('2d');
        if (!context) throw new Error(`Cannot prepare repeated texture ${label}.`);
        context.imageSmoothingEnabled = input.filter !== 'point';
        context.drawImage(image, 0, 0, surface.width, surface.height);
        pixels = surface;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else {
      const channel = input === 'white' ? 255 : 0;
      const pixels = new Uint8Array([channel, channel, channel, 255]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    const filter = !solid && input.filter === 'point' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, solid ? gl.CLAMP_TO_EDGE : textureWrap(gl, input.wrapU));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, solid ? gl.CLAMP_TO_EDGE : textureWrap(gl, input.wrapV));
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`Texture ${label} upload failed with WebGL error ${error}.`);
    return texture;
  } catch (error) {
    gl.deleteTexture(texture);
    throw error;
  } finally {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

function instanceMatrix(name: string, instance: GlMeshInstance): Numbers | undefined {
  switch (name.replace(/^hlslcc_mtx4x4/, '')) {
    case 'unity_ObjectToWorld': return instance.objectToWorld;
    case 'unity_WorldToObject': return instance.worldToObject;
    case 'unity_MatrixVP': return instance.viewProjection;
    default: return undefined;
  }
}

function writeUniform(gl: WebGLRenderingContext, info: ShaderUniform, material: GlMeshMaterial, instance: GlMeshInstance) {
  const { name, size, type, location } = info;
  const matrix = instanceMatrix(name, instance);
  if (matrix) {
    const data = floats(matrix, 16, name);
    if (type === gl.FLOAT_VEC4 && size <= 4) {
      gl.uniform4fv(location, data.subarray(0, size * 4));
    } else if (type === gl.FLOAT_MAT4 && size === 1) {
      gl.uniformMatrix4fv(location, false, data);
    } else {
      throw new Error(`Unsupported Unity matrix uniform type for ${name}.`);
    }
    return;
  }
  const value = name === '_Time' ? instance.time
    : name === '_WorldSpaceCameraPos' ? instance.cameraPosition
    : instance.uniforms?.[name] ?? material.uniforms?.[name];
  if (value === undefined) throw new Error(`Missing active shader uniform ${name}.`);
  const values = typeof value === 'number' ? [value] : value;
  const components = attributeComponents(gl, type);
  if (components) {
    const packed = floats(values, size * components, name);
    switch (components) {
      case 1: gl.uniform1fv(location, packed); break;
      case 2: gl.uniform2fv(location, packed); break;
      case 3: gl.uniform3fv(location, packed); break;
      case 4: gl.uniform4fv(location, packed); break;
    }
    return;
  }
  const intComponents = type === gl.INT || type === gl.BOOL ? 1
    : type === gl.INT_VEC2 || type === gl.BOOL_VEC2 ? 2
    : type === gl.INT_VEC3 || type === gl.BOOL_VEC3 ? 3
    : type === gl.INT_VEC4 || type === gl.BOOL_VEC4 ? 4 : 0;
  if (!intComponents) throw new Error(`Unsupported uniform type ${type} for ${name}.`);
  const integers = Array.from(values);
  if (integers.length !== size * intComponents
    || !integers.every((n) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647)) {
    throw new RangeError(`Uniform ${name} requires ${size * intComponents} signed 32-bit integers.`);
  }
  switch (intComponents) {
    case 1: gl.uniform1iv(location, integers); break;
    case 2: gl.uniform2iv(location, integers); break;
    case 3: gl.uniform3iv(location, integers); break;
    case 4: gl.uniform4iv(location, integers); break;
  }
}

/** Dedicated transparent WebGL1 renderer for static triangle meshes, in caller-supplied draw order. */
export class GlMeshRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly meshes = new Map<GlMesh, MeshBuffers>();
  private readonly materials = new Map<GlMeshMaterialHandle, MaterialProgram>();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, private readonly compositeEffects = false) {
    const gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: compositeEffects, preserveDrawingBuffer: true, depth: false,
    });
    if (!gl) throw new Error('Could not create a WebGL1 context.');
    const setup = gl.getContextAttributes();
    if (!setup?.alpha || !setup.preserveDrawingBuffer) {
      throw new Error('A transparent WebGL1 drawing buffer with preservation is required.');
    }
    this.gl = gl;
  }

  private assertReady(): void {
    if (this.disposed) throw new Error('The WebGL mesh renderer is disposed.');
    if (this.gl.isContextLost()) throw new Error('The WebGL1 context was lost.');
  }

  private createBuffer(target: number, data: ArrayBufferView<ArrayBuffer>, usage: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Cannot allocate a WebGL buffer.');
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
    return buffer;
  }

  createMesh(data: GlMeshData): GlMesh {
    this.assertReady();
    const gl = this.gl;
    const vertexCount = data.vertices.length / 3;
    if (!Number.isSafeInteger(vertexCount) || vertexCount === 0) {
      throw new RangeError('Mesh vertices must contain complete xyz positions.');
    }
    if (!data.indices && vertexCount % 3 !== 0) {
      throw new RangeError('An unindexed mesh needs complete triangles.');
    }
    const attributes = new Map<string, VertexBuffer>();
    const mesh: MeshBuffers = { attributes };
    const handle = { vertexCount };
    const add = (name: string, components: number, values: Numbers | undefined) => {
      if (values === undefined) return;
      const packed = floats(values, vertexCount * components, name);
      const buffer = this.createBuffer(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
      attributes.set(name, { buffer, components });
      if (name === 'in_COLOR0') mesh.colors = packed;
    };
    try {
      add('in_POSITION0', 3, data.vertices);
      add('in_NORMAL0', 3, data.normals);
      add('in_COLOR0', 4, data.colors);
      add('in_TEXCOORD1', 4, data.texcoord1);
      add('in_TEXCOORD2', 4, data.texcoord2);
      if (data.uv0) {
        const uv0 = floats(data.uv0, vertexCount * 2, 'uv0');
        const uv1 = data.uv1 && floats(data.uv1, vertexCount * 2, 'uv1');
        const packed = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
          packed.set(uv0.subarray(i * 2, i * 2 + 2), i * 4);
          if (uv1) packed.set(uv1.subarray(i * 2, i * 2 + 2), i * 4 + 2);
        }
        add('in_TEXCOORD0', 4, packed);
        mesh.uv = packed;
      } else if (data.uv1) {
        throw new Error('uv1 requires uv0 for the packed TEXCOORD0 attribute.');
      }
      if (data.indices) {
        const indices = Array.from(data.indices);
        if (!indices.length || indices.length % 3 !== 0
          || !indices.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
          throw new RangeError('Mesh indices must form complete in-range triangles.');
        }
        const wide = indices.some((index) => index > 65535);
        if (wide && !gl.getExtension('OES_element_index_uint')) {
          throw new Error('32-bit mesh indices require OES_element_index_uint.');
        }
        const packed = wide ? Uint32Array.from(indices) : Uint16Array.from(indices);
        mesh.indices = {
          buffer: this.createBuffer(gl.ELEMENT_ARRAY_BUFFER, packed, gl.STATIC_DRAW),
          count: packed.length, type: wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        };
      }
      this.meshes.set(handle, mesh);
      return handle;
    } catch (error) {
      this.deleteMesh(mesh);
      throw error;
    }
  }

  async createMaterial(material: GlMeshMaterial): Promise<GlMeshMaterialHandle> {
    this.assertReady();
    const gl = this.gl;
    const program = linkProgram(gl, material);
    const textures: MaterialProgram['textures'] = [];
    try {
      const { attributes, uniforms } = reflectProgram(gl, program);
      const samplers = uniforms.filter(({ type }) => type === gl.SAMPLER_2D || type === gl.SAMPLER_CUBE);
      if (samplers.length > Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS))) {
        throw new Error('The material exceeds the WebGL texture unit limit.');
      }
      const images = await Promise.all(samplers.map(async (uniform) => {
        if (uniform.type !== gl.SAMPLER_2D || uniform.size !== 1) {
          throw new Error(`Only single sampler2D inputs are supported. Found ${uniform.name}.`);
        }
        const input = material.textures?.[uniform.name];
        if (input === undefined) throw new Error(`Missing active sampler texture ${uniform.name}.`);
        return { uniform, input, image: typeof input === 'string' ? null : await loadBattleImage(input.url) };
      }));
      this.assertReady();
      gl.activeTexture(gl.TEXTURE0);
      for (const { uniform, input, image } of images) {
        textures.push({ uniform, texture: uploadTexture(gl, input, image, uniform.name, this.compositeEffects) });
      }
      const handle = { attributes: attributes.map(({ name }) => name) };
      this.materials.set(handle, {
        program, attributes, uniforms: uniforms.filter((info) => !samplers.includes(info)), textures, material,
      });
      return handle;
    } catch (error) {
      for (const { texture } of textures) gl.deleteTexture(texture);
      gl.deleteProgram(program);
      throw error;
    }
  }

  private colorBuffer(mesh: MeshBuffers, tint: Float32Array<ArrayBuffer>): WebGLBuffer {
    const gl = this.gl;
    const colors = mesh.colors;
    if (!colors) throw new Error('The mesh has no vertex color buffer.');
    if (!mesh.tinted) {
      const values = new Float32Array(colors.length);
      mesh.tinted = { values, buffer: this.createBuffer(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW) };
    }
    const { values, buffer } = mesh.tinted;
    for (let i = 0; i < values.length; i++) values[i] = colors[i]! * tint[i % 4]!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, values);
    return buffer;
  }

  private sheetBuffer(mesh: MeshBuffers, rect: readonly [number, number, number, number]): WebGLBuffer {
    const gl = this.gl;
    const uv = mesh.uv;
    if (!uv) throw new Error('The mesh has no source UV stream for its flipbook.');
    if (!mesh.sheet) {
      const values = Float32Array.from(uv);
      mesh.sheet = { values, buffer: this.createBuffer(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW) };
    }
    const { buffer, values } = mesh.sheet;
    for (let i = 0; i < values.length; i += 4) {
      values[i] = uv[i]! * rect[0] + rect[2];
      values[i + 1] = uv[i + 1]! * rect[1] + rect[3];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, values);
    return buffer;
  }

  render(instances: readonly GlMeshInstance[]): void {
    this.assertReady();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const instance of instances) this.draw(instance);
  }

  private draw(instance: GlMeshInstance): void {
    const gl = this.gl;
    const mesh = this.meshes.get(instance.mesh);
    const program = this.materials.get(instance.material);
    if (!mesh || !program) throw new Error('This renderer does not own the mesh or material.');
    gl.useProgram(program.program);
    for (const info of program.uniforms) writeUniform(gl, info, program.material, instance);
    for (const [unit, { uniform, texture }] of program.textures.entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniform.location, unit);
    }
    const { blend, cull } = program.material;
    if (cull) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(cull === 'front' ? gl.FRONT : gl.BACK);
    } else gl.disable(gl.CULL_FACE);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      if (this.compositeEffects) {
        gl.blendFuncSeparate(blend.src, blend.dst, gl.ONE, blend.dst === gl.ONE ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      } else gl.blendFunc(blend.src, blend.dst);
    } else {
      gl.disable(gl.BLEND);
    }

    const enabled: number[] = [];
    try {
      const tint = instance.vertexColor && floats(instance.vertexColor, 4, 'vertexColor');
      for (const { name, location, components } of program.attributes) {
        if (name === 'in_TEXCOORD1' && instance.custom1) {
          gl.disableVertexAttribArray(location);
          gl.vertexAttrib4fv(location, floats(instance.custom1, 4, 'custom1'));
          continue;
        }
        const source = mesh.attributes.get(name);
        if (!source) {
          if (name !== 'in_COLOR0' || !tint) {
            throw new Error(`The mesh has no values for active shader attribute ${name}.`);
          }
          gl.disableVertexAttribArray(location);
          gl.vertexAttrib4fv(location, tint);
          continue;
        }
        const buffer = name === 'in_COLOR0' && tint ? this.colorBuffer(mesh, tint)
          : name === 'in_TEXCOORD0' && instance.uvRect ? this.sheetBuffer(mesh, instance.uvRect) : source.buffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const size = Math.min(source.components, components);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, source.components * 4, 0);
        gl.enableVertexAttribArray(location);
        enabled.push(location);
      }
      if (mesh.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices.buffer);
        gl.drawElements(gl.TRIANGLES, mesh.indices.count, mesh.indices.type, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, instance.mesh.vertexCount);
      }
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`Mesh draw failed with WebGL error ${error}.`);
    } finally {
      for (const location of enabled) gl.disableVertexAttribArray(location);
    }
  }

  private deleteMesh(mesh: MeshBuffers): void {
    for (const { buffer } of mesh.attributes.values()) this.gl.deleteBuffer(buffer);
    if (mesh.indices) this.gl.deleteBuffer(mesh.indices.buffer);
    if (mesh.tinted) this.gl.deleteBuffer(mesh.tinted.buffer);
    if (mesh.sheet) this.gl.deleteBuffer(mesh.sheet.buffer);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    for (const mesh of this.meshes.values()) this.deleteMesh(mesh);
    for (const material of this.materials.values()) {
      for (const { texture } of material.textures) gl.deleteTexture(texture);
      gl.deleteProgram(material.program);
    }
    this.meshes.clear();
    this.materials.clear();
  }
}
