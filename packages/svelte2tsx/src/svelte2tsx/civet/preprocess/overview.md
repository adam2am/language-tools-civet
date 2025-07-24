graph TD
    A[Unmapped Segment] --> B{Cheap Whitelist Check};
    B --> |In Whitelist| C{Fast TraceMap};
    B --> |Not in Whitelist| D[STOP: Compiler Artifact];
    C --> |Found| E[DONE];
    C --> |Not Found| F{Slower Heuristic Search};
    F --> |Found| E;
    F --> |Not Found| G{Slowest AST Search};
    G --> |Found| E;
    G --> |Not Found| H[FAIL: No Mapping Found];