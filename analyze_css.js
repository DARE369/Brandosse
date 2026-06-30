const fs = require('fs');
const path = require('path');

const cssFile = path.join(__dirname, 'src/admin/styles/AdminDashboard.css');
const searchDir = path.join(__dirname, 'src/admin');

function getAllFiles(dirPath, arrayOfFiles) {
    files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            if (file.endsWith('.jsx') || file.endsWith('.js')) {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        }
    });

    return arrayOfFiles;
}

try {
    const cssContent = fs.readFileSync(cssFile, 'utf8');
    // Regex to match class selectors. This is a simple regex and might have false positives/negatives but good enough for a first pass.
    // Matches .classname, .class-name, etc. at start of line or after } or { or ; or space
    // It excludes pseudo-classes like :hover
    const classRegex = /\.([a-zA-Z0-9_-]+)(?=[^{}]*\{)/g;

    const classes = new Set();
    let match;
    while ((match = classRegex.exec(cssContent)) !== null) {
        classes.add(match[1]);
    }

    console.log(`Found ${classes.size} unique classes in CSS.`);

    const files = getAllFiles(searchDir);
    console.log(`Scanning ${files.length} files in ${searchDir}...`);

    const unusedClasses = [];
    const usedClasses = new Set();

    // Pre-read all file contents to avoid reading for every class
    const fileContents = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

    classes.forEach(cls => {
        // Simple string search. 
        // We look for the class name in the file content.
        // We might want to be stricter (e.g. className="... cls ..." or className={`... ${cls} ...`})
        // but a simple inclusion check is safer to avoid false positives (saying it's unused when it is).
        // If the string exists, we assume it's used.
        if (fileContents.includes(cls)) {
            usedClasses.add(cls);
        } else {
            unusedClasses.push(cls);
        }
    });

    console.log(`\nFound ${unusedClasses.length} unused classes:`);
    unusedClasses.forEach(c => console.log(c));

} catch (err) {
    console.error("Error:", err);
}
