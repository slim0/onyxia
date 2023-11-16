import { defaultPalette } from "onyxia-ui";
import { env } from "env-parsed";
import { mergeDeep } from "ui/tools/mergeDeep";

export const palette = {
    ...mergeDeep(defaultPalette, env.PALETTE_OVERRIDE),
    "limeGreen": {
        "main": "#BAFF29",
        "light": "#E2FFA6"
    },
    "agentConnectBlue": {
        "main": "#0579EE",
        "light": "#2E94FA",
        "lighter": "#E5EDF5"
    }
};