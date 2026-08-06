/*
 * The plugin's `import ... from 'react'` resolves HERE, and here reads the app's own React off
 * window.crateHost. This is the one rule dynamic React plugins live or die by: there must be
 * exactly one React instance, because hooks dispatch through the instance that rendered the
 * tree — a plugin carrying its own copy renders once and then every hook call throws.
 */
const React = window.crateHost.React;
export default React;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const memo = React.memo;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
