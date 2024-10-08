import "minimal-polyfills/Object.fromEntries";
import { id } from "tsafe/id";
import type { State as RootState, Thunks } from "core/bootstrap";
import * as deploymentRegionManagement from "core/usecases/deploymentRegionManagement";
import { parseUrl } from "core/tools/parseUrl";
import { assert } from "tsafe/assert";
import { createUsecaseActions, createSelector } from "clean-architecture";

//TODO: Refactor, replicate the k8sCodeSnippets usecase

export type Technology =
    | "R (aws.S3)"
    | "R (aws.S3)"
    | "R (paws)"
    | "Python (s3fs)"
    | "Python (boto3)"
    | "Python (polars)"
    | "shell environment variables"
    | "MC client"
    | "s3cmd"
    | "rclone";

type State = State.NotRefreshed | State.Ready;

namespace State {
    type Common = {
        isRefreshing: boolean;
    };

    export type NotRefreshed = Common & {
        stateDescription: "not refreshed";
    };

    export type Ready = Common & {
        stateDescription: "ready";
        expirationTime: number;
        credentials: {
            AWS_ACCESS_KEY_ID: string;
            AWS_SECRET_ACCESS_KEY: string;
            AWS_DEFAULT_REGION: string;
            AWS_SESSION_TOKEN: string;
            AWS_S3_ENDPOINT: string;
        };
        selectedTechnology: Technology;
    };
}

export const name = "s3CodeSnippets";

export const { reducer, actions } = createUsecaseActions({
    name,
    "initialState": id<State>(
        id<State.NotRefreshed>({
            "stateDescription": "not refreshed",
            "isRefreshing": false
        })
    ),
    "reducers": {
        "refreshStarted": state => {
            state.isRefreshing = true;
        },
        "refreshed": (
            state,
            {
                payload
            }: {
                payload: {
                    credentials: State.Ready["credentials"];
                    expirationTime: number;
                };
            }
        ) => {
            const { credentials, expirationTime } = payload;

            const selectedTechnology: Technology =
                state.stateDescription === "ready"
                    ? state.selectedTechnology
                    : "R (paws)";

            return id<State.Ready>({
                "isRefreshing": false,
                "stateDescription": "ready",
                selectedTechnology,
                credentials,
                expirationTime
            });
        },
        "technologyChanged": (
            state,
            { payload }: { payload: { technology: Technology } }
        ) => {
            const { technology } = payload;
            assert(state.stateDescription === "ready");
            state.selectedTechnology = technology;
        }
    }
});

export const thunks = {
    /** Can, and must be called before the slice is refreshed,
     * tels if the feature is available.
     */
    "isAvailable":
        () =>
        (...args): boolean => {
            const [, , { s3ClientSts }] = args;

            return s3ClientSts !== undefined;
        },
    /** Refresh is expected to be called whenever the component that use this slice mounts */
    "refresh":
        (params: { doForceRenewToken: boolean }) =>
        async (...args) => {
            const { doForceRenewToken } = params;

            const [dispatch, getState, thunkExtraArguments] = args;

            const { s3ClientSts } = thunkExtraArguments;

            assert(s3ClientSts !== undefined);

            if (getState().s3CodeSnippets.isRefreshing) {
                return;
            }

            dispatch(actions.refreshStarted());

            const { region, host, port } = (() => {
                const { s3 } =
                    deploymentRegionManagement.selectors.currentDeploymentRegion(
                        getState()
                    );

                assert(s3 !== undefined);

                const { host, port = 443 } = parseUrl(s3.url);

                const region = s3.region;

                return { region, host, port };
            })();

            const tokens = await s3ClientSts.getToken({
                "doForceRenew": doForceRenewToken
            });

            assert(tokens !== undefined);
            assert(tokens.sessionToken !== undefined);
            assert(tokens.expirationTime !== undefined);

            dispatch(
                actions.refreshed({
                    "credentials": {
                        "AWS_ACCESS_KEY_ID": tokens.accessKeyId,
                        "AWS_SECRET_ACCESS_KEY": tokens.secretAccessKey,
                        "AWS_DEFAULT_REGION": region ?? "",
                        "AWS_SESSION_TOKEN": tokens.sessionToken,
                        "AWS_S3_ENDPOINT": `${
                            host === "s3.amazonaws.com"
                                ? `s3.${region}.amazonaws.com`
                                : host
                        }${port === 443 ? "" : `:${port}`}`
                    },
                    "expirationTime": tokens.expirationTime
                })
            );
        },
    "changeTechnology":
        (params: { technology: Technology }) =>
        (...args) => {
            const { technology } = params;
            const [dispatch] = args;
            dispatch(actions.technologyChanged({ technology }));
        }
} satisfies Thunks;

export const selectors = (() => {
    const readyState = (rootState: RootState): State.Ready | undefined => {
        const state = rootState.s3CodeSnippets;
        switch (state.stateDescription) {
            case "ready":
                return state;
            default:
                return undefined;
        }
    };

    const isReady = createSelector(readyState, state => state !== undefined);

    const selectedTechnology = createSelector(readyState, state => {
        if (state === undefined) {
            return undefined;
        }

        return state.selectedTechnology;
    });

    const credentials = createSelector(readyState, state => {
        if (state === undefined) {
            return undefined;
        }

        return state.credentials;
    });

    const initScript = createSelector(
        isReady,
        selectedTechnology,
        credentials,
        (isReady, selectedTechnology, credentials) => {
            if (!isReady) {
                return undefined;
            }

            assert(selectedTechnology !== undefined);
            assert(credentials !== undefined);

            return {
                "fileBasename": ((): string => {
                    switch (selectedTechnology) {
                        case "R (aws.S3)":
                        case "R (paws)":
                            return "credentials.R";
                        case "Python (s3fs)":
                        case "Python (boto3)":
                        case "Python (polars)":
                            return "credentials.py";
                        case "shell environment variables":
                        case "MC client":
                            return ".bashrc";
                        case "s3cmd":
                            return ".s3cmd";
                        case "rclone":
                            return "rclone.conf";
                    }
                })(),
                "scriptCode": ((): string => {
                    switch (selectedTechnology) {
                        case "R (aws.S3)":
                            return `
install.packages("aws.s3", repos = "https://cloud.R-project.org")

Sys.setenv("AWS_ACCESS_KEY_ID" = "${credentials.AWS_ACCESS_KEY_ID}",
           "AWS_SECRET_ACCESS_KEY" = "${credentials.AWS_SECRET_ACCESS_KEY}",
           "AWS_DEFAULT_REGION" = "${credentials.AWS_DEFAULT_REGION}",
           "AWS_SESSION_TOKEN" = "${credentials.AWS_SESSION_TOKEN}",
           "AWS_S3_ENDPOINT"= "${credentials.AWS_S3_ENDPOINT}")

library("aws.s3")
bucketlist(region="")
`;
                        case "R (paws)":
                            return `
install.packages("paws", repos = "https://cloud.R-project.org")

Sys.setenv("AWS_ACCESS_KEY_ID" = "${credentials.AWS_ACCESS_KEY_ID}",
           "AWS_SECRET_ACCESS_KEY" = "${credentials.AWS_SECRET_ACCESS_KEY}",
           "AWS_DEFAULT_REGION" = "${credentials.AWS_DEFAULT_REGION}",
           "AWS_SESSION_TOKEN" = "${credentials.AWS_SESSION_TOKEN}",
           "AWS_S3_ENDPOINT"= "${credentials.AWS_S3_ENDPOINT}")

library("paws")
minio <- paws::s3(config = list(
	credentials = list(
	  creds = list(
		access_key_id = Sys.getenv("AWS_ACCESS_KEY_ID"),
		secret_access_key = Sys.getenv("AWS_SECRET_ACCESS_KEY"),
		session_token = Sys.getenv("AWS_SESSION_TOKEN")
	  )),
	endpoint = paste0("https://", Sys.getenv("AWS_S3_ENDPOINT")),
	region = Sys.getenv("AWS_DEFAULT_REGION")))
  
minio$list_buckets()
						`;
                        case "Python (s3fs)":
                            return `
import os
import s3fs
os.environ["AWS_ACCESS_KEY_ID"] = '${credentials.AWS_ACCESS_KEY_ID}'
os.environ["AWS_SECRET_ACCESS_KEY"] = '${credentials.AWS_SECRET_ACCESS_KEY}'
os.environ["AWS_SESSION_TOKEN"] = '${credentials.AWS_SESSION_TOKEN}'
os.environ["AWS_DEFAULT_REGION"] = '${credentials.AWS_DEFAULT_REGION}'
fs = s3fs.S3FileSystem(
    client_kwargs={'endpoint_url': 'https://'+'${credentials.AWS_S3_ENDPOINT}'},
    key = os.environ["AWS_ACCESS_KEY_ID"], 
    secret = os.environ["AWS_SECRET_ACCESS_KEY"], 
    token = os.environ["AWS_SESSION_TOKEN"])
						`;
                        case "Python (boto3)":
                            return `
import boto3
s3 = boto3.client("s3",endpoint_url = 'https://'+'${credentials.AWS_S3_ENDPOINT}',
                  aws_access_key_id= '${credentials.AWS_ACCESS_KEY_ID}', 
                  aws_secret_access_key= '${credentials.AWS_SECRET_ACCESS_KEY}', 
                  aws_session_token = '${credentials.AWS_SESSION_TOKEN}')
						`;
                        case "Python (polars)":
                            return `
import polars as pl
storage_options = {
    "aws_endpoint":  'https://'+'${credentials.AWS_S3_ENDPOINT}',
    "aws_access_key_id": os.environ["AWS_ACCESS_KEY_ID"],
    "aws_secret_access_key": os.environ["AWS_SECRET_ACCESS_KEY"],
    "aws_region": os.environ["AWS_DEFAULT_REGION"],
    "aws_token": os.environ["AWS_SESSION_TOKEN"]
  }
  # or hard-coded :
  storage_options = {
    "aws_endpoint":  'https://'+'${credentials.AWS_S3_ENDPOINT}',
    "aws_access_key_id": '${credentials.AWS_ACCESS_KEY_ID}', 
    "aws_secret_access_key": '${credentials.AWS_SECRET_ACCESS_KEY}', 
    "aws_region": '${credentials.AWS_DEFAULT_REGION}'
    "aws_token": '${credentials.AWS_SESSION_TOKEN}'
  }
  df = pl.scan_parquet(source = "s3://bucket/*.parquet", storage_options=storage_options)
  print(df)

						`;
                        case "shell environment variables":
                            return `
export AWS_ACCESS_KEY_ID=${credentials.AWS_ACCESS_KEY_ID}
export AWS_SECRET_ACCESS_KEY=${credentials.AWS_SECRET_ACCESS_KEY}
export AWS_DEFAULT_REGION=${credentials.AWS_DEFAULT_REGION}
export AWS_SESSION_TOKEN=${credentials.AWS_SESSION_TOKEN}
export AWS_S3_ENDPOINT=${credentials.AWS_S3_ENDPOINT}
						`;
                        case "MC client":
                            return `
export MC_HOST_s3=https://${credentials.AWS_ACCESS_KEY_ID}:${credentials.AWS_SECRET_ACCESS_KEY}:${credentials.AWS_SESSION_TOKEN}@${credentials.AWS_S3_ENDPOINT}
						`;
                        case "s3cmd":
                            return `
[default]
access_key = ${credentials.AWS_ACCESS_KEY_ID}
access_token = ${credentials.AWS_SESSION_TOKEN}
add_encoding_exts =
add_headers =
bucket_location = us-east-1
ca_certs_file =
cache_file =
check_ssl_certificate = False
check_ssl_hostname = False
cloudfront_host = cloudfront.amazonaws.com
default_mime_type = binary/octet-stream
delay_updates = False
delete_after = False
delete_after_fetch = False
delete_removed = False
dry_run = False
enable_multipart = True
encoding = UTF-8
encrypt = False
expiry_date =
expiry_days =
expiry_prefix =
follow_symlinks = False
force = False
get_continue = False
gpg_command = /usr/bin/gpg
gpg_decrypt = %(gpg_command)s -d --verbose --no-use-agent --batch --yes --passphrase-fd %(passphrase_fd)s -o %(output_file)s %(input_file)s
gpg_encrypt = %(gpg_command)s -c --verbose --no-use-agent --batch --yes --passphrase-fd %(passphrase_fd)s -o %(output_file)s %(input_file)s
gpg_passphrase =
guess_mime_type = True
host_base = ${credentials.AWS_S3_ENDPOINT}
host_bucket = ${credentials.AWS_S3_ENDPOINT}
human_readable_sizes = False
invalidate_default_index_on_cf = False
invalidate_default_index_root_on_cf = True
invalidate_on_cf = False
kms_key =
limitrate = 0
list_md5 = False
log_target_prefix =
long_listing = False
max_delete = -1
mime_type =
multipart_chunk_size_mb = 15
multipart_max_chunks = 10000
preserve_attrs = True
progress_meter = True
proxy_host =
proxy_port = 0
put_continue = False
recursive = False
recv_chunk = 65536
reduced_redundancy = False
requester_pays = False
restore_days = 1
secret_key = ${credentials.AWS_SECRET_ACCESS_KEY}
send_chunk = 65536
server_side_encryption = False
signature_v2 = False
simpledb_host = sdb.amazonaws.com
skip_existing = False
socket_timeout = 300
stats = False
stop_on_error = False
storage_class =
urlencoding_mode = normal
use_https = True
use_mime_magic = True
verbosity = WARNING
website_endpoint = http://%(bucket)s.s3-website-%(location)s.amazonaws.com/
website_error =
website_index = index.html
						`;
                        case "rclone":
                            return `
[minio]
type = s3
provider = Minio
env_auth = false
upload_concurrency = 5
acl = private
bucket_acl = private
endpoint = ${credentials.AWS_S3_ENDPOINT}
access_key_id = ${credentials.AWS_ACCESS_KEY_ID}
secret_access_key = ${credentials.AWS_SECRET_ACCESS_KEY}
session_token = ${credentials.AWS_SESSION_TOKEN}
						`;
                    }
                })()
                    .replace(/^\n/, "")
                    .replace(/[\t\n]+$/, ""),
                "programmingLanguage": ((): string => {
                    switch (selectedTechnology) {
                        case "R (aws.S3)":
                        case "R (paws)":
                            return "r";
                        case "Python (s3fs)":
                        case "Python (boto3)":
                        case "Python (polars)":
                            return "python";
                        case "shell environment variables":
                        case "MC client":
                            return "bash";
                        case "s3cmd":
                        case "rclone":
                            //NOTE: Not supported by the react-code-block
                            return "init";
                    }
                })()
            };
        }
    );

    const expirationTime = createSelector(readyState, state => {
        if (state === undefined) {
            return undefined;
        }

        return state.expirationTime;
    });

    const isRefreshing = createSelector(readyState, state => {
        if (state === undefined) {
            return undefined;
        }

        return state.isRefreshing;
    });

    return {
        isReady,
        credentials,
        selectedTechnology,
        initScript,
        expirationTime,
        isRefreshing
    };
})();
