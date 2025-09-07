import express, { Request, Response } from 'express';
import * as Minio from 'minio';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// EJS View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// MinIO Client Configuration
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT as string,
  port: parseInt(process.env.MINIO_PORT as string, 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY as string,
  secretKey: process.env.MINIO_SECRET_KEY as string,
});

const bucketName = process.env.MINIO_BUCKET_NAME as string;

// Function to ensure the bucket exists
const checkBucket = async () => {
  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName);
      console.log(`Bucket '${bucketName}' created successfully.`);
    } else {
      console.log(`Bucket '${bucketName}' already exists.`);
    }
  } catch (err) {
    console.error('Error checking or creating bucket:', err);
    process.exit(1);
  }
};

// --- GUI Routes ---

// Render the main page with a list of objects
app.get('/', async (req: Request, res: Response) => {
  try {
    const objectsList: { name: string; size: number }[] = [];
    const stream = minioClient.listObjects(bucketName, '', true);

    stream.on('data', (obj) => {
      obj.name && obj.size && objectsList.push({ name: obj.name, size: obj.size });
    });

    stream.on('error', (err) => {
      throw err;
    });

    stream.on('end', () => {
      res.render('index', { objects: objectsList, bucketName: bucketName });
    });
  } catch (error) {
    res.status(500).render('error', { message: 'Failed to list objects.' });
  }
});

// Handle file upload via form submission
app.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).render('error', { message: 'No file uploaded.' });
  }

  const file = req.file;
  const objectName = `${Date.now()}-${file.originalname}`;
  
  // Define metadata, including Content-Type
  const metaData = {
    'Content-Type': file.mimetype,
  };
  console.debug('Metadata:', metaData);
  console.debug('File Size', file.size);
  try {	  	
    // Pass the metadata to the putObject method
    await minioClient.putObject(bucketName, objectName, file.buffer, file.size, metaData);
    res.redirect('/');
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).render('error', { message: 'Failed to upload file.' });
  }
});

// Handle file deletion via form submission
app.post('/delete', async (req: Request, res: Response) => {
  const { objectName } = req.body;
  
  if (!objectName) {
    return res.status(400).render('error', { message: 'Object name is missing.' });
  }

  try {
    await minioClient.removeObject(bucketName, objectName);
    res.redirect('/');
  } catch (error) {
    res.status(500).render('error', { message: 'Failed to delete object.' });
  }
});

// Handle file download
app.get('/download/:objectName', async (req: Request, res: Response) => {
  const { objectName } = req.params;

  try {
    const stat = await minioClient.statObject(bucketName, objectName);
    res.setHeader('Content-Type', stat.metaData['content-type']);
    res.setHeader('Content-Disposition', `attachment; filename="${objectName}"`);

    const fileStream = await minioClient.getObject(bucketName, objectName);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).render('error', { message: 'Failed to download file or file not found.' });
  }
});

// Serve an image preview directly from the S3 bucket
app.get('/preview/:objectName', async (req: Request, res: Response) => {
  const { objectName } = req.params;

  try {
    const stat = await minioClient.statObject(bucketName, objectName);
    
    // Check if the object is an image
    if (stat.metaData['content-type'].startsWith('image/')) {
      const fileStream = await minioClient.getObject(bucketName, objectName);
      res.setHeader('Content-Type', stat.metaData['content-type']);
      fileStream.pipe(res);
    } else {
      res.status(400).send('File is not an image.');
    }
  } catch (error) {
    res.status(404).send('Image not found.');
  }
});


// Start the server
checkBucket().then(() => {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
});