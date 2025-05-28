const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const authRoutes = require('../routes/auth');
const userRoutes = require('../routes/user');

const app = express();

const corsOptions = {
    origin: 'http://localhost:3000',
    credentials: true // Разрешение использования куки
    }
    
app.use(cors(corsOptions));

app.use(bodyParser.json());



// Роуты
app.use('/auth', authRoutes);
app.use('/user', userRoutes);

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));