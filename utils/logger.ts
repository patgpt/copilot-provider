import pino from "pino";

const logger = pino({
    name: "build",
    level: "info",
    enabled: true,
    formatters: {
        level: (label) => {
            return { level: label };
        },
    },
    errorKey: "error",
    customLevels: {
        "ASTEROID-IMPACT": 45,
        "NUCLEAR-EXPLOSION": 50,
        "CERN MALFUNCTION": 45,
        "ALIEN-INVASION": 50,
        "ZOMBIE-APOCALYPSE": 50,
        "ROBOT-REBELLION": 45,
        
    },
    messageKey: "message",
    transport: {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
        },
    },
});

export default logger;