/** base_read — read and parse an Obsidian .base file (YAML) */
export declare function baseRead(vaultPath: string, path: string): {
    path: string;
    content: Record<string, unknown>;
} | {
    error: string;
    message: string;
};
/** base_write — write an Obsidian .base file (object → YAML) */
export declare function baseWrite(vaultPath: string, path: string, content: Record<string, unknown>): {
    path: string;
    created: boolean;
} | {
    error: string;
    message: string;
};
/** canvas_read — read and parse an Obsidian .canvas file (JSON) */
export declare function canvasRead(vaultPath: string, path: string): {
    path: string;
    nodes: unknown[];
    edges: unknown[];
} | {
    error: string;
    message: string;
};
/** canvas_write — write an Obsidian .canvas file with validation */
export declare function canvasWrite(vaultPath: string, path: string, nodes: unknown[], edges?: unknown[]): {
    path: string;
    created: boolean;
    node_count: number;
    edge_count: number;
} | {
    error: string;
    message: string;
};
//# sourceMappingURL=bases-canvas.d.ts.map