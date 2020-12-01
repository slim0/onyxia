
import type {
    AppThunk,
    Dependencies,
    ParamsNeededToInitializeKeycloakClient,
    ParamsNeededToInitializeVaultClient
} from "../setup";
import { assert } from "evt/tools/typeSafety/assert";

import type { getVaultClientProxyWithTranslator } from "../ports/VaultClient";

export type AppConstant = AppConstant.LoggedIn | AppConstant.NotLoggedIn;

export declare namespace AppConstant {

    export type _Common = {
        isPrefersColorSchemeDark: boolean;
        vaultConfig: Readonly<Pick<ParamsNeededToInitializeVaultClient.Real, "baseUri" | "engine" | "role">>;
        keycloakConfig: Readonly<ParamsNeededToInitializeKeycloakClient.Real["keycloakConfig"]>;
    };

    export type LoggedIn = _Common & {
        isUserLoggedIn: true;
        userProfile: {
            idep: string;
            email: string;
            nomComplet: string;
        };
        evtVaultCliTranslation: ReturnType<typeof getVaultClientProxyWithTranslator>["evtTranslation"];

    };

    export type NotLoggedIn = _Common & {
        isUserLoggedIn: false;
    };

}

export const name = "appConstants";

const appConstantsByDependenciesRef = new WeakMap<Dependencies, AppConstant>();

export const thunks = {
    "getAppConstants":
        (): AppThunk<Readonly<AppConstant>> => (...args) => {

            const [, , dependencies] = args;

            const appConstants = appConstantsByDependenciesRef.get(dependencies);

            assert(appConstants !== undefined);

            return appConstants;


        },
};

export const privateThunks = {
    "initialize":
        (params: { appConstants: AppConstant; }): AppThunk => async (...args) => {

            const { appConstants } = params;

            const [, , dependencies] = args;

            appConstantsByDependenciesRef.set(dependencies, appConstants);

        }
};