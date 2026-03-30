import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

function throwIfNull<T>(
	value: T | null,
	message = "Expected value to be non-null",
): T {
	if (value === null) {
		throw new Error(message);
	}
	return value;
}

export { cn, throwIfNull };
