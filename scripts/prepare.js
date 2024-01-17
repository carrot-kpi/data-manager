if (!process.env.SKIP_GIT_HOOKS_SETUP) {
    (await import("husky")).install();
    console.log("Git hooks installed");
} else {
    console.log("Git hooks installation skipped");
}
