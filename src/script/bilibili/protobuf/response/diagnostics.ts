import { Middleware } from '@core/middleware';
import { Logger } from '@core/logger';
import { AbortError, ExitError, exit } from '@core/process';

export const diagnostics: Middleware = async (ctx, next) => {
    let argument: Record<string, unknown> = {};
    try {
        const parsed = typeof $argument === 'string' ? JSON.parse($argument) : {};
        if (parsed && typeof parsed === 'object') argument = parsed;
    } catch {
        // Existing argument middleware handles malformed arguments later.
    }
    Logger.setLevel(String(argument.logLevel ?? 4));
    const route = ctx.request.url.split('?')[0].split('/').slice(3).join('/');
    const started = Date.now();
    Logger.info(`[Protobuf] Start ${route}; bytes=${ctx.response.bodyBytes?.length}`);
    try {
        if (/\/ViewProgress$/.test(ctx.request.url)) {
            const enabled = (value: unknown) => Boolean(value && value !== '#');
            if (!enabled(argument.sponsorBlock ?? true) && !enabled(argument.sponsorBlockLegacy)) {
                Logger.info('[Protobuf] ViewProgress bypassed: both helpers are off.');
                exit();
            }
        }
        await next();
    } catch (error) {
        if (error instanceof ExitError || error instanceof AbortError) throw error;
        // Do not stringify the complete binary response into an error log.
        Logger.error(`[Protobuf] Failed ${route}: ${String(error)}`);
        exit();
    } finally {
        Logger.info(`[Protobuf] Complete ${route}; elapsed=${Date.now() - started}ms`);
    }
};
