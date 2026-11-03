-- admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  last_login DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example insert (generate the hash with PHP CLI and replace <HASH>):
-- php -r "echo password_hash('YourStrongPasswordHere', PASSWORD_ARGON2ID).PHP_EOL;"
INSERT INTO admin_users (username, password_hash) VALUES
('admin', '<HASH>');