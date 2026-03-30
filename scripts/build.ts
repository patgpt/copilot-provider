



// a cli build tool for the project to help the user build the project. 


import { exec } from "child_process";
import pino from "pino";
import { promisify } from "util";
import logger from "../utils/logger";

const execAsync = promisify(exec);

async function build() {
    try {
        logger.info("Building the project...");

        const result = await Bun.build({
            entrypoints: ["src/index.ts"],
            outdir: "dist",
            
            minify: true,
            sourcemap: true,
            target: "node",
            files: {
                "src/index.ts": "dist/index.js",
            },
            format: "esm",
            compile: true,
            tsconfig: "tsconfig.json", 
            naming: "[name].[hash].[ext]",
            
        });

        
        
        logger.info(result, "Build result:");
        
        if(result.logs) {
            logger.info(result.logs, "Build logs:");
        }

        logger.info("Build completed successfully....i guess");
    } catch (error) {
        logger.error(error, "Build failed:");
    }
}

build();