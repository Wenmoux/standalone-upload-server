module.exports = {
    testDir: "./tests/smoke",
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    use: {
        headless: true,
        trace: "retain-on-failure"
    },
    reporter: [["list"]]
};
