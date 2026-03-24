/**
 * Sanitizes cookies to ensure they are compatible with Playwright's addCookies.
 * Playwright strictly requires 'sameSite' to be 'Strict', 'Lax', or 'None'.
 * It also expects valid boolean/numeric values for other fields.
 */
export function sanitizeCookies(cookies) {
    if (!cookies || !Array.isArray(cookies)) return [];

    return cookies.map(c => {
        const copy = { ...c };

        // Handle sameSite
        if (copy.sameSite === null || copy.sameSite === undefined) {
            delete copy.sameSite;
        } else if (typeof copy.sameSite === 'string') {
            const lower = copy.sameSite.toLowerCase();
            if (lower === 'no_restriction') {
                copy.sameSite = 'None';
            } else if (lower === 'strict') {
                copy.sameSite = 'Strict';
            } else if (lower === 'lax') {
                copy.sameSite = 'Lax';
            } else if (lower === 'none') {
                copy.sameSite = 'None';
            } else {
                delete copy.sameSite; // Remove unknown sameSite values
            }
        } else {
            delete copy.sameSite;
        }

        // Ensure secure is boolean
        if (Object.prototype.hasOwnProperty.call(copy, 'secure')) {
            copy.secure = !!copy.secure;
        }

        // Ensure httpOnly is boolean
        if (Object.prototype.hasOwnProperty.call(copy, 'httpOnly')) {
            copy.httpOnly = !!copy.httpOnly;
        }

        return copy;
    });
}
