export interface SidecarHandlers {
    onSync: () => Promise<void>;
    onRadarItemUpdate: (path: string, state: "resolved" | "active", email_id?: string) => void;
}
/** Start the HTTP sidecar on a random port */
export declare function startSidecar(vaultPath: string, handlers: SidecarHandlers): Promise<number>;
/** Stop the HTTP sidecar and clean up the port file */
export declare function stopSidecar(): void;
//# sourceMappingURL=http-sidecar.d.ts.map