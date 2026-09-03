import type { Either } from "effect";
import type {
  CapabilityGapError,
  TaskAffectingFailureError,
  TransientFailureError,
} from "../errors";

export type EndpointFailure =
  | CapabilityGapError
  | TransientFailureError
  | TaskAffectingFailureError;

/** The per-endpoint result the manifest records: success data, or which of the three failure shapes occurred. */
export type EndpointResult<A> = Either.Either<A, EndpointFailure>;
