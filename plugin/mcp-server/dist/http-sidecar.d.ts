export interface SidecarHandlers {
    onSync: () => Promise<void>;
    onRadarItemUpdate: (path: string, state: "resolved" | "active", email_id?: string) => void;
}
export interface SidecarOptions {
    authToken: string;
}
/** Start the HTTP sidecar on a random port */
export declare function startSidecar(vaultPath: string, handlers: SidecarHandlers, options: SidecarOptions): Promise<number>;
/** Stop the HTTP sidecar and clean up the port file */
export declare function stopSidecar(): void;
//# sourceMappingURL=http-sidecar.d.ts.map