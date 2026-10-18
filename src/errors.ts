export class UnsadaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class ForbiddenUrlError extends UnsadaError {}

export class LoginPendingError extends UnsadaError {
    constructor() {
        super(
            "A browser window was opened so the user can sign in to the UNSAdA classroom with Google. " +
                "Ask the user to finish signing in there, then call the tool again.",
        );
    }
}

export class LoginFailedError extends UnsadaError {}

export class SessionRejectedError extends UnsadaError {
    constructor() {
        super("The classroom rejected a session that was just created. Ask the user to run `unsada-mcp login`.");
    }
}

export class NotEnrolledError extends UnsadaError {
    constructor(path: string) {
        super(`The user is not enrolled in the course behind ${path}.`);
    }
}

export class ClassroomHttpError extends UnsadaError {
    constructor(
        readonly status: number,
        path: string,
    ) {
        super(
            status === 404
                ? `The classroom has no page at ${path}.`
                : `The classroom answered HTTP ${status} for ${path}.`,
        );
    }
}

export class ClassroomUnreachableError extends UnsadaError {
    constructor(cause: unknown) {
        super(`Could not reach the classroom: ${cause instanceof Error ? cause.message : String(cause)}.`);
    }
}

export class ExternalRedirectError extends UnsadaError {
    constructor(readonly target: string) {
        super(`The page redirects outside the classroom, to ${target}.`);
    }
}

export class TooLargeError extends UnsadaError {
    constructor(what: string, limitBytes: number) {
        super(`${what} is larger than ${Math.round(limitBytes / 1024 / 1024)} MB.`);
    }
}

export class SessionExpiredError extends Error {}
