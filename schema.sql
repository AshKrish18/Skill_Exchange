-- Skills Exchange Platform: Modules 1 & 2
-- Run:  psql -U postgres -c "CREATE DATABASE skillexchange_db;"
--       psql -U postgres -d skillexchange_db -f schema.sql

DROP TABLE IF EXISTS user_skill CASCADE;
DROP TABLE IF EXISTS skill CASCADE;
DROP TABLE IF EXISTS profile CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ===== MODULE 1: User Authentication & Profile Management =====

CREATE TABLE users (
    user_id             SERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    email               VARCHAR(100) NOT NULL UNIQUE,
    password            VARCHAR(255) NOT NULL,          -- bcrypt hash
    phone               VARCHAR(15),
    verification_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED','VERIFIED')),
    availability        VARCHAR(100),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE profile (
    profile_id   SERIAL PRIMARY KEY,
    user_id      INT NOT NULL UNIQUE
                 REFERENCES users(user_id) ON DELETE CASCADE,
    bio          VARCHAR(300),
    interests    VARCHAR(100),
    availability VARCHAR(100)
);

-- ===== MODULE 2: Skill Listing & Portfolio =====

CREATE TABLE skill (
    skill_id    SERIAL PRIMARY KEY,
    skill_name  VARCHAR(100) NOT NULL UNIQUE,
    category    VARCHAR(50),
    description VARCHAR(300)
);

CREATE TABLE user_skill (
    user_skill_id    SERIAL PRIMARY KEY,
    user_id          INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    skill_id         INT NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE,
    skill_type       VARCHAR(5) NOT NULL CHECK (skill_type IN ('OFFER','WANT')),
    experience_level VARCHAR(30) NOT NULL
                     CHECK (experience_level IN ('Beginner','Intermediate','Advanced','Expert')),
    description      VARCHAR(300),
    portfolio_link   VARCHAR(200),
    preferred_timing VARCHAR(100),
    UNIQUE (user_id, skill_id, skill_type)
);

-- Indexes (FK lookups and skill browsing)
CREATE INDEX idx_user_skill_user  ON user_skill(user_id);
CREATE INDEX idx_user_skill_skill ON user_skill(skill_id);
CREATE INDEX idx_skill_category   ON skill(category);

-- Seed catalogue
INSERT INTO skill (skill_name, category, description) VALUES
 ('Python',        'Programming', 'General purpose programming'),
 ('JavaScript',    'Programming', 'Web programming'),
 ('SQL',           'Programming', 'Relational databases'),
 ('UI/UX Design',  'Design',      'Interface and experience design'),
 ('Public Speaking','Communication','Presentations and speeches'),
 ('Spanish',       'Language',    'Spanish language'),
 ('Guitar',        'Music',       'Acoustic and electric guitar');
