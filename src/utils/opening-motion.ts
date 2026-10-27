export function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function openingSceneProgress(raw: number): number {
	return clamp((raw - 0.10) / (0.90 - 0.10));
}

export function followOpeningProgress(
	current: number,
	target: number,
	seconds: number,
): number {
	return current + (target - current) * -Math.expm1(-6 * Math.max(0, seconds));
}

export function smoothBetween(start: number, end: number, progress: number): number {
	const t = clamp((progress - start) / (end - start));
	return t * t * (3 - 2 * t);
}

