import zipfile
import os
import shutil

base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # repo root
zip_path = os.path.join(base_dir, 'models', 'vosk-model.zip')
dest_dir = os.path.join(base_dir, 'models', 'vosk')
models_parent = os.path.join(base_dir, 'models')

print(f"Extracting {zip_path} -> {dest_dir}")
with zipfile.ZipFile(zip_path, 'r') as z:
    top_dir = z.namelist()[0].split('/')[0]
    z.extractall(models_parent)

extracted_path = os.path.join(models_parent, top_dir)
if os.path.abspath(extracted_path) != os.path.abspath(dest_dir):
    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)
    os.rename(extracted_path, dest_dir)

if os.path.exists(zip_path):
    os.remove(zip_path)

print(f"Successfully extracted Vosk model to: {dest_dir}")
