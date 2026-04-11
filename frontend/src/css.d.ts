// Allow side-effect CSS imports (e.g. import './Component.css')
// Webpack css-loader handles the actual bundling at build time.
declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}
