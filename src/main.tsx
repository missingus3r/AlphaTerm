import { render } from "solid-js/web";
import { App } from "./App";
import { installFontAccess } from "./settings/fonts";
import "./styles.css";

// Antes de que cualquier terminal active las ligaduras.
installFontAccess();

render(() => <App />, document.getElementById("root")!);
