const argon2 = require('argon2');

async function generateHash(password) {
    try {
        // Generates a hash compatible with your server.js settings
        const hash = await argon2.hash(password, {
            type: argon2.argon2id,
            memoryCost: 65536,
            timeCost: 4,
            parallelism: 1
        });
        console.log("Your Secure Hash:");
        console.log(hash);
    } catch (err) {
        console.error(err);
    }
}

// Replace 'YourStrongPasswordHere' with the password you want to use
generateHash('YourStrongPasswordHere');