import { render } from "solid-js/web";
import { App } from "./App";
import { installFontAccess } from "./settings/fonts";
import "./styles.css";

// Before any terminal enables ligatures.
installFontAccess();

render(() => <App />, document.getElementById("root")!);
