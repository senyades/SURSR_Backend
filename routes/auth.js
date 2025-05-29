// authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db'); // Подключение к PostgreSQL через pg-pool

// Регистрация
router.post('/register', async (req, res) => {
    const { login, password, role, full_name } = req.body;
    if (!login || !password || !role || !full_name) {
        return res.status(400).json({ message: 'Все поля обязательны' });
    }

    try {
        const userCheck = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ message: 'Логин уже существует' });
        }

        const hash = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            'INSERT INTO users (login, password_hash, role, full_name) VALUES ($1, $2, $3, $4) RETURNING id',
            [login, hash, role, full_name]
        );

        const userId = newUser.rows[0].id;

        if (role === 'student') {
            await pool.query('INSERT INTO students (user_id) VALUES ($1)', [userId]);
        } else if (role === 'teacher') {
            await pool.query('INSERT INTO teachers (user_id) VALUES ($1)', [userId]);
        }

        res.status(201).json({ message: 'Пользователь зарегистрирован', userId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Вход
router.post('/login', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.status(400).json({ message: 'Введите логин и пароль' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'Пользователь не найден' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            return res.status(400).json({ message: 'Неверный пароль' });
        }

        // Возвращаем базовую информацию — клиент сохранит login и userId
        res.status(200).json({
            message: 'Успешный вход',
            user: {
                id: user.id,
                login: user.login,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

module.exports = router;
