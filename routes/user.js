const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');

router.post('/themes', async (req, res) => {
  try {
    const { title, description, type, source, supervisor_id, priority } = req.body;
    
    // Проверка обязательных полей
    if (!title || !type || !source) {
      return res.status(400).json({ error: 'Необходимо заполнить все обязательные поля' });
    }
    
    // Проверка валидности типа
    const validTypes = ['coursework', 'bachelor', 'master', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип работы' });
    }
    
    // Проверка валидности источника
    const validSources = ['teacher', 'student', 'employer', 'other'];
    if (!validSources.includes(source)) {
      return res.status(400).json({ error: 'Недопустимый источник темы' });
    }
    
    // Проверка приоритета
    const validPriority = priority >= 0 && priority <= 3;
    if (!validPriority) {
      return res.status(400).json({ error: 'Приоритет должен быть от 0 до 3' });
    }
    
    // SQL-запрос для вставки новой темы
    const query = `
      INSERT INTO themes (
        title, 
        description, 
        type, 
        source, 
        status, 
        supervisor_id, 
        created_by, 
        priority
      ) 
      VALUES ($1, $2, $3, $4, 'available', $5, $6, $7)
      RETURNING *;
    `;
    
    // Значения для запроса
    const values = [
      title,
      description || null,
      type,
      source,
      supervisor_id || null,
      1, // Здесь должен быть ID авторизованного пользователя
      priority || 0
    ];
    
    // Выполнение запроса
    const { rows } = await pool.query(query, values);
    
    // Отправка успешного ответа
    res.status(201).json({
      message: 'Тема успешно добавлена',
      theme: rows[0]
    });
    
  } catch (error) {
    console.error('Ошибка при добавлении темы:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});


router.get('/listthemes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.type,
        t.source,
        t.status,
        t.priority,
        t.created_at,
        u.full_name AS supervisor_name
      FROM themes t
      LEFT JOIN teachers teach ON t.supervisor_id = teach.user_id
      LEFT JOIN users u ON teach.user_id = u.id
      ORDER BY t.created_at DESC
    `);
    
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      error: 'Ошибка сервера',
      details: error.message
    });
  }
});

// Маршрут для получения списка преподавателей
router.get('/teachers', async (req, res) => {
  try {
    // Проверяем наличие необходимых таблиц
    const tablesExist = await pool.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teachers') AS teachers_exists,
             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') AS users_exists
    `);
    
    const { teachers_exists, users_exists } = tablesExist.rows[0];
    
    if (!teachers_exists || !users_exists) {
      return res.status(500).json({
        error: 'Недоступны необходимые таблицы',
        details: `teachers_exists: ${teachers_exists}, users_exists: ${users_exists}`
      });
    }

    // Основной запрос
    const query = `
      SELECT 
        t.user_id AS id,
        u.full_name AS name,
        t.department,
        t.position
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE u.role = 'teacher'
      ORDER BY u.full_name ASC;
    `;
    
    const { rows } = await pool.query(query);
    
    // Логирование для отладки
    console.log(`Получено ${rows.length} преподавателей`);
    
    res.json(rows);
    
  } catch (error) {
    // Подробное логирование ошибки
    console.error('Ошибка при выполнении запроса преподавателей:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Ошибка базы данных',
      details: error.message,
      hint: 'Проверьте структуру таблиц users и teachers'
    });
  }
});


router.get('/get_students', async (req, res) => {
  try {
    // Запрос с объединением таблиц users и students
    const query = `
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.login,
        u.created_at,
        s.group_name,
        s.phone
      FROM users u
      JOIN students s ON u.id = s.user_id
      WHERE u.role = 'student'
      ORDER BY u.full_name ASC
    `;

    const { rows } = await pool.query(query);

    if (rows.length === 0) {
      return res.status(404).json({ 
        message: 'Студенты не найдены',
        suggestions: [
          'Проверьте наличие студентов в базе данных',
          'Убедитесь что пользователи имеют роль "student"'
        ]
      });
    }

    res.json({
      count: rows.length,
      students: rows
    });
    
  } catch (err) {
    console.error('Ошибка при получении списка студентов:', err);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      details: err.message
    });
  }
});

// Обновление данных студента
router.put('/update_student/:id', async (req, res) => {
  const studentId = req.params.id;
  const { full_name, group_name, phone } = req.body;

  // Проверка обязательных полей
  if (!full_name || !group_name) {
    return res.status(400).json({
      error: 'Необходимо указать ФИО и группу студента'
    });
  }

  try {
    // Начинаем транзакцию
    await pool.query('BEGIN');

    // 1. Обновляем данные в таблице users
    const userUpdateQuery = `
      UPDATE users
      SET full_name = $1
      WHERE id = $2
      RETURNING *;
    `;
    const userUpdateValues = [full_name, studentId];
    const userResult = await pool.query(userUpdateQuery, userUpdateValues);

    if (userResult.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // 2. Обновляем данные в таблице students
    const studentUpdateQuery = `
      UPDATE students
      SET group_name = $1, phone = $2
      WHERE user_id = $3
      RETURNING *;
    `;
    const studentUpdateValues = [group_name, phone || null, studentId];
    const studentResult = await pool.query(studentUpdateQuery, studentUpdateValues);

    if (studentResult.rowCount === 0) {
      // Если есть пользователь, но нет связанной записи в students
      // Создаем запись в students
      const createStudentQuery = `
        INSERT INTO students (user_id, group_name, phone)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      const createValues = [studentId, group_name, phone || null];
      await pool.query(createStudentQuery, createValues);
    }

    // Фиксируем транзакцию
    await pool.query('COMMIT');

    // Получаем обновленные данные студента
    const studentDataQuery = `
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.login,
        u.created_at,
        s.group_name,
        s.phone
      FROM users u
      LEFT JOIN students s ON u.id = s.user_id
      WHERE u.id = $1;
    `;
    const { rows } = await pool.query(studentDataQuery, [studentId]);

    res.json({
      message: 'Данные студента успешно обновлены',
      student: rows[0]
    });

  } catch (err) {
    // Откатываем транзакцию в случае ошибки
    await pool.query('ROLLBACK');
    console.error('Ошибка при обновлении студента:', err);
    
    // Обработка ошибки уникальности логина (если бы мы его обновляли)
    if (err.constraint === 'users_login_key') {
      return res.status(400).json({ error: 'Логин уже занят' });
    }
    
    res.status(500).json({ 
      error: 'Ошибка сервера при обновлении данных студента',
      details: err.message
    });
  }
});



router.put('/update_teacher/:id', async (req, res) => {
  const teacherId = req.params.id;
  const { full_name, department, position } = req.body;

  // Проверка обязательных полей
  if (!full_name) {
    return res.status(400).json({
      error: 'Необходимо указать ФИО преподавателя'
    });
  }

  try {
    // Начинаем транзакцию
    await pool.query('BEGIN');

    // 1. Обновляем данные в таблице users
    const userUpdateQuery = `
      UPDATE users
      SET full_name = $1
      WHERE id = $2
      RETURNING *;
    `;
    const userUpdateValues = [full_name, teacherId];
    const userResult = await pool.query(userUpdateQuery, userUpdateValues);

    if (userResult.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // 2. Обновляем данные в таблице teachers
    const teacherUpdateQuery = `
      UPDATE teachers
      SET department = $1, position = $2
      WHERE user_id = $3
      RETURNING *;
    `;
    const teacherUpdateValues = [department || null, position || null, teacherId];
    const teacherResult = await pool.query(teacherUpdateQuery, teacherUpdateValues);

    if (teacherResult.rowCount === 0) {
      // Если есть пользователь, но нет связанной записи в teachers
      const createTeacherQuery = `
        INSERT INTO teachers (user_id, department, position)
        VALUES ($1, $2, $3)
        RETURNING *;
      `;
      const createValues = [teacherId, department || null, position || null];
      await pool.query(createTeacherQuery, createValues);
    }

    // Фиксируем транзакцию
    await pool.query('COMMIT');

    // Получаем обновленные данные преподавателя
    const teacherDataQuery = `
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.login,
        u.created_at,
        t.department,
        t.position
      FROM users u
      LEFT JOIN teachers t ON u.id = t.user_id
      WHERE u.id = $1;
    `;
    const { rows } = await pool.query(teacherDataQuery, [teacherId]);

    res.json({
      message: 'Данные преподавателя успешно обновлены',
      teacher: rows[0]
    });

  } catch (err) {
    // Откатываем транзакцию в случае ошибки
    await pool.query('ROLLBACK');
    console.error('Ошибка при обновлении преподавателя:', err);
    
    res.status(500).json({ 
      error: 'Ошибка сервера при обновлении данных преподавателя',
      details: err.message
    });
  }
});


router.get('/distributions', async (req, res) => {
  try {
    const query = `
      SELECT * FROM distributions
      ORDER BY deadline DESC, created_at DESC;
    `;
    
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении распределений:', err);
    res.status(500).json({ 
      error: 'Ошибка сервера',
      details: err.message
    });
  }
});

router.post('/distributions', async (req, res) => {
  const { discipline, group_name, teacher_id, type, deadline } = req.body;
  
  // Валидация
  if (!discipline || !group_name || !teacher_id || !type || !deadline) {
    return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
  }
  
  try {
    const query = `
      INSERT INTO distributions (discipline, group_name, teacher_id, type, deadline)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    
    const values = [discipline, group_name, teacher_id, type, new Date(deadline)];
    const { rows } = await pool.query(query, values);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при создании распределения:', err);
    res.status(500).json({ 
      error: 'Ошибка сервера',
      details: err.message
    });
  }
});

router.patch('/distributions/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!status || !['active', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  
  try {
    const query = `
      UPDATE distributions
      SET status = $1
      WHERE id = $2
      RETURNING *;
    `;
    
    const { rows } = await pool.query(query, [status, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Распределение не найдено' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Ошибка при обновлении статуса распределения:', err);
    res.status(500).json({ 
      error: 'Ошибка сервера',
      details: err.message
    });
  }
});

module.exports = router;
