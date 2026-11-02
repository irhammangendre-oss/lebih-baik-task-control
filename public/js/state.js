// State global sederhana untuk user yang login.
export const state = { me: null };
export const can = (perm) => !!state.me && state.me.permissions.includes(perm);
export const canAny = (...perms) => perms.some(can);
