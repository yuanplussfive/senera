import { assertAndroidReleaseSigning } from "../Apps/Mobile/AndroidBuildContract.js";

assertAndroidReleaseSigning(process.env, "base64");
process.stdout.write("Android release signing configuration is present.\n");
