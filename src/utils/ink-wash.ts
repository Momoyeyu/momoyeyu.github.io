export interface InkWash {
	render(progress: number): void;
	resize(width: number, height: number, ratio: number): void;
	dispose(): void;
}

export type InkWashRenderer = InkWash;

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
    vUv = aPosition * .5 + .5;
    gl_Position = vec4(aPosition, 0., 1.);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D uImage;
uniform float uProgress;
varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
        mix(hash(i + vec2(0., 1.)), hash(i + vec2(1.)), f.x), f.y);
}
float fbm(vec2 p) {
    float value = noise(p) * .57;
    p = mat2(.80, -.60, .60, .80) * p * 2.03 + 7.1;
    value += noise(p) * .28;
    p = mat2(.80, -.60, .60, .80) * p * 2.03 + 3.7;
    return value + noise(p) * .15;
}
vec4 pigment(vec2 uv) {
    // The image has a transparent margin. Outside the sheet, keep it empty.
    vec2 inside = step(vec2(0.), uv) * step(uv, vec2(1.));
    return texture2D(uImage, clamp(uv, 0., 1.)) * inside.x * inside.y;
}
vec4 wetPigment(vec2 uv, vec2 radius) {
    vec4 value = pigment(uv) * .28;
    value += pigment(uv + vec2(radius.x, 0.)) * .12;
    value += pigment(uv - vec2(radius.x, 0.)) * .12;
    value += pigment(uv + vec2(0., radius.y)) * .12;
    value += pigment(uv - vec2(0., radius.y)) * .12;
    value += pigment(uv + radius) * .06;
    value += pigment(uv - radius) * .06;
    value += pigment(uv + vec2(radius.x, -radius.y)) * .06;
    value += pigment(uv + vec2(-radius.x, radius.y)) * .06;
    return value;
}
void main() {
    float p = clamp(uProgress, 0., 1.);
    if (p <= .00001) {
        gl_FragColor = pigment(vUv);
        return;
    }
    if (p >= .99999) {
        gl_FragColor = vec4(0.);
        return;
    }

    // A broad, continuous water field, rather than disconnected grains.
    float wet = sin(p * 3.14159265);
    vec2 water = vec2(fbm(vUv * 3.2 + vec2(p * .55, 1.8)),
        fbm(vUv * 3.2 + vec2(9.3, -p * .45))) - .5;
    vec2 drift = vec2(.025, .040) * smoothstep(.12, .92, p);
    vec2 uv = vUv - drift + water * wet * .075;

    // Ink loosens at the quill, then travels toward the vane above the rising feed.
    float field = dot(vUv, vec2(.64, .36))
        + (fbm(vUv * 4.1 + water * .9) - .5) * .24;
    float advance = p * p;
    float front = mix(-.28, 1.25, advance);
    float keep = smoothstep(front - .18, front + .18, field);
    float edge = 4. * keep * (1. - keep);

    vec4 source = pigment(uv);
    vec2 radius = vec2(.010, .019) * wet * (1. + edge * 1.9);
    vec4 wash = wetPigment(uv + water * wet * .018, radius);
    float diffusion = smoothstep(.08, .55, p) * .62;
    vec4 body = mix(source, wash, diffusion) * keep;
    // Diluted ink stays close to the moving wet edge and never reforms.
    vec4 bleed = wash * edge * wet * .34;
    gl_FragColor = (body + bleed * (1. - body.a))
        * (1. - smoothstep(.90, 1., p));
}`;

/** An on-demand ink wash. The caller owns scroll timing and animation frames. */
export function createInkWash(
	canvas: HTMLCanvasElement,
	image: HTMLImageElement,
): InkWash | null {
	const gl = canvas.getContext("webgl", {
		alpha: true,
		antialias: false,
		premultipliedAlpha: true,
		powerPreference: "low-power",
	});
	if (!gl) return null;

	const shaders: WebGLShader[] = [];
	let program: WebGLProgram | null = null;
	let buffer: WebGLBuffer | null = null;
	let texture: WebGLTexture | null = null;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (texture) gl.deleteTexture(texture);
		if (buffer) gl.deleteBuffer(buffer);
		if (program) gl.deleteProgram(program);
		for (const shader of shaders) gl.deleteShader(shader);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	};

	try {
		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type);
			if (!shader) throw new Error("Ink shader unavailable");
			shaders.push(shader);
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				throw new Error(gl.getShaderInfoLog(shader) || "Ink shader failed");
			}
			return shader;
		};
		program = gl.createProgram();
		if (!program) throw new Error("Ink program unavailable");
		gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) || "Ink program failed");
		}
		gl.useProgram(program);

		buffer = gl.createBuffer();
		texture = gl.createTexture();
		if (!buffer || !texture) throw new Error("Ink resources unavailable");
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
		]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, "aPosition");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.uniform1i(gl.getUniformLocation(program, "uImage"), 0);
		const progress = gl.getUniformLocation(program, "uProgress");
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);

		return {
			render(value) {
				if (disposed || gl.isContextLost()) return;
				gl.uniform1f(progress, Math.min(1, Math.max(0, value)));
				gl.drawArrays(gl.TRIANGLES, 0, 6);
			},
			resize(width, height, ratio) {
				if (disposed) return;
				const nextWidth = Math.max(1, Math.round(width * ratio));
				const nextHeight = Math.max(1, Math.round(height * ratio));
				if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
					canvas.width = nextWidth;
					canvas.height = nextHeight;
				}
				gl.viewport(0, 0, nextWidth, nextHeight);
			},
			dispose,
		};
	} catch {
		dispose();
		return null;
	}
}
