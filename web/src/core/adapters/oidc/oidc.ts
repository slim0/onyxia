import type { Oidc } from "core/ports/Oidc";
import { createOidc as createOidcSpa } from "oidc-spa";
import type { OidcParams, OidcParams_Partial } from "core/ports/OnyxiaApi";
import { objectKeys } from "tsafe/objectKeys";

export async function createOidc<AutoLogin extends boolean>(
    params: OidcParams & {
        transformUrlBeforeRedirect: (url: string) => string;
        autoLogin: AutoLogin;
    }
): Promise<AutoLogin extends true ? Oidc.LoggedIn : Oidc> {
    const {
        issuerUri,
        clientId,
        scope_spaceSeparated,
        clientSecret,
        transformUrlBeforeRedirect,
        extraQueryParams_raw,
        autoLogin
    } = params;

    const oidc = await createOidcSpa({
        issuerUri,
        clientId,
        __unsafe_clientSecret: clientSecret,
        scopes: scope_spaceSeparated?.split(" "),
        transformUrlBeforeRedirect: url => {
            url = transformUrlBeforeRedirect(url);

            if (extraQueryParams_raw !== undefined) {
                url += `&${extraQueryParams_raw}`;
            }

            return url;
        },
        homeUrl: import.meta.env.BASE_URL,
        debugLogs: false
    });

    if (!oidc.isUserLoggedIn) {
        if (autoLogin) {
            await oidc.login({ doesCurrentHrefRequiresAuth: true });
            // NOTE: Never
        }

        //@ts-expect-error: We know what we are doing
        return oidc;
    }

    return {
        ...oidc,
        getTokens: () => oidc.getTokens_next()
    };
}

export function mergeOidcParams(params: {
    oidcParams: OidcParams;
    oidcParams_partial: OidcParams_Partial;
}) {
    const { oidcParams, oidcParams_partial } = params;

    const oidcParams_merged = { ...oidcParams };

    for (const key of objectKeys(oidcParams_partial)) {
        const value = oidcParams_partial[key];
        if (value !== undefined) {
            oidcParams_merged[key] = value;
        }
    }

    return oidcParams_merged;
}
