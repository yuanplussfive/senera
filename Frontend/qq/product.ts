import product from "../../package.json";
import frontend from "../package.json";

/** Product identity and dependencies come from the owning application manifests. */
export default { ...product, dependencies: frontend.dependencies };
