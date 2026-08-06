/* The automatic JSX runtime, from the same single React the shim above guards. */
const rt = window.crateHost.jsxRuntime;
export const jsx = rt.jsx;
export const jsxs = rt.jsxs;
export const Fragment = rt.Fragment;
