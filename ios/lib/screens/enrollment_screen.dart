import 'dart:math';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:go_router/go_router.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';
import '../i18n/app_localizations.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../models/template.dart';
import '../storage/templates_repo.dart';
import '../services/tts_service.dart';

enum EnrollStep { form, capture, processing }

class EnrollmentScreen extends StatefulWidget {
  final String? prefilledUserId;
  final String? prefilledName;
  final String? purpose;
  final String? returnTo;

  const EnrollmentScreen({
    super.key,
    this.prefilledUserId,
    this.prefilledName,
    this.purpose,
    this.returnTo,
  });

  @override
  State<EnrollmentScreen> createState() => _EnrollmentScreenState();
}

class _EnrollmentScreenState extends State<EnrollmentScreen> {
  EnrollStep _currentStep = EnrollStep.form;
  final _idController = TextEditingController();
  final _nameController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  // Camera
  CameraController? _cameraController;
  bool _cameraReady = false;
  bool _cameraPermissionGranted = false;

  // Face detection
  final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      enableLandmarks: true,
      enableContours: true,
      performanceMode: FaceDetectorMode.accurate,
    ),
  );

  // Capture state
  int _captureStep = 0; // 0=frontal, 1=left, 2=right
  final List<List<double>> _embeddings = [];
  bool _isCapturing = false;
  bool _enrollmentSuccess = false;
  String? _errorMessage;

  final TtsService _tts = TtsService();
  final TemplatesRepo _templatesRepo = TemplatesRepo();

  final List<String> _captureInstructions = [
    'Look straight at the camera',
    'Turn your head slightly LEFT',
    'Turn your head slightly RIGHT',
  ];

  @override
  void initState() {
    super.initState();
    _checkCameraPermission();
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _faceDetector.close();
    _idController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _checkCameraPermission() async {
    final status = await Permission.camera.status;
    if (status.isGranted) {
      setState(() => _cameraPermissionGranted = true);
    } else {
      final result = await Permission.camera.request();
      setState(() => _cameraPermissionGranted = result.isGranted);
    }
  }

  Future<void> _initCamera() async {
    if (!_cameraPermissionGranted) return;

    final cameras = await availableCameras();
    final frontCamera = cameras.firstWhere(
      (cam) => cam.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );

    _cameraController = CameraController(
      frontCamera,
      ResolutionPreset.medium,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.nv21,
    );

    try {
      await _cameraController!.initialize();
      if (mounted) {
        setState(() => _cameraReady = true);
        _speakInstruction();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to initialize camera: $e';
        });
      }
    }
  }

  void _speakInstruction() {
    final loc = AppLocalizations.of(context);
    String instruction;
    switch (_captureStep) {
      case 0:
        instruction =
            loc?.t('enroll.step_frontal') ?? _captureInstructions[0];
        break;
      case 1:
        instruction =
            loc?.t('enroll.step_left') ?? _captureInstructions[1];
        break;
      case 2:
        instruction =
            loc?.t('enroll.step_right') ?? _captureInstructions[2];
        break;
      default:
        return;
    }
    _tts.speak(instruction);
  }

  void _startEnrollment() {
    if (!_formKey.currentState!.validate()) return;

    if (_idController.text.trim().isEmpty ||
        _nameController.text.trim().isEmpty) {
      final loc = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              loc?.t('enroll.error_fields') ?? 'Please enter both ID and name.'),
        ),
      );
      return;
    }

    setState(() {
      _currentStep = EnrollStep.capture;
    });
    _initCamera();
  }

  Future<void> _captureFrame() async {
    if (_isCapturing || _cameraController == null || !_cameraReady) return;

    setState(() => _isCapturing = true);

    try {
      final image = await _cameraController!.takePicture();
      final inputImage = InputImage.fromFilePath(image.path);
      final faces = await _faceDetector.processImage(inputImage);

      if (faces.isEmpty) {
        final loc = AppLocalizations.of(context);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(loc?.t('enroll.no_face') ??
                  'No face detected - position in frame'),
              backgroundColor: Colors.orange,
            ),
          );
        }
        setState(() => _isCapturing = false);
        return;
      }

      // Generate a mock embedding from face landmarks for now
      // In production, this would use the TFLite face embedding model
      final face = faces.first;
      final embedding = _generateEmbeddingFromFace(face);
      _embeddings.add(embedding);

      if (_captureStep < 2) {
        setState(() {
          _captureStep++;
          _isCapturing = false;
        });
        _speakInstruction();
      } else {
        // All 3 captures done - process
        setState(() {
          _currentStep = EnrollStep.processing;
          _isCapturing = false;
        });
        await _processEnrollment();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isCapturing = false;
          _errorMessage = 'Capture failed: $e';
        });
      }
    }
  }

  List<double> _generateEmbeddingFromFace(Face face) {
    // Generate a 128-dimensional embedding vector from face data
    // In production, this would be extracted by the EdgeFace TFLite model
    final random = Random(face.boundingBox.hashCode);
    final headEulerAngleY = face.headEulerAngleY ?? 0.0;
    final headEulerAngleZ = face.headEulerAngleZ ?? 0.0;

    final embedding = List<double>.generate(128, (i) {
      // Use face geometry to seed a deterministic embedding
      final base = (face.boundingBox.width * face.boundingBox.height) / 100000;
      return (random.nextDouble() - 0.5) +
          base * 0.01 +
          headEulerAngleY * 0.001 * (i % 7) +
          headEulerAngleZ * 0.001 * (i % 11);
    });

    // L2 normalize
    final norm = sqrt(embedding.fold<double>(0, (s, v) => s + v * v));
    if (norm > 0) {
      for (int i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  Future<void> _processEnrollment() async {
    try {
      // Compute mean embedding from 3 captures
      final meanEmbedding = List<double>.filled(128, 0.0);
      for (final emb in _embeddings) {
        for (int i = 0; i < emb.length && i < 128; i++) {
          meanEmbedding[i] += emb[i];
        }
      }
      for (int i = 0; i < meanEmbedding.length; i++) {
        meanEmbedding[i] /= _embeddings.length;
      }

      // L2 normalize the mean
      final norm =
          sqrt(meanEmbedding.fold<double>(0, (s, v) => s + v * v));
      if (norm > 0) {
        for (int i = 0; i < meanEmbedding.length; i++) {
          meanEmbedding[i] /= norm;
        }
      }

      // Save template to DB
      final template = FaceTemplate(
        id: const Uuid().v4(),
        userId: _idController.text.trim(),
        name: _nameController.text.trim(),
        embedding: meanEmbedding,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      );

      await _templatesRepo.insertTemplate(template);

      if (mounted) {
        setState(() => _enrollmentSuccess = true);
        final loc = AppLocalizations.of(context);
        _tts.speak(loc?.t('enroll.success') ?? 'Enrollment successful!');
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _enrollmentSuccess = false;
          _errorMessage = 'Enrollment failed: $e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final loc = AppLocalizations.of(context);
    final themeNotifier = context.watch<ThemeNotifier>();
    final colors =
        themeNotifier.isAAA ? AppColors.aaa : AppColors.normal;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        backgroundColor: colors.bg,
        foregroundColor: colors.text,
        title: Text(loc?.t('enroll.title') ?? 'Enroll New Face'),
        elevation: 0,
      ),
      body: SafeArea(
        child: _buildCurrentStep(colors, loc),
      ),
    );
  }

  Widget _buildCurrentStep(dynamic colors, AppLocalizations? loc) {
    switch (_currentStep) {
      case EnrollStep.form:
        return _buildFormStep(colors, loc);
      case EnrollStep.capture:
        return _buildCaptureStep(colors, loc);
      case EnrollStep.processing:
        return _buildProcessingStep(colors, loc);
    }
  }

  Widget _buildFormStep(dynamic colors, AppLocalizations? loc) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 20),
            // Employee ID field
            TextFormField(
              controller: _idController,
              style: TextStyle(color: colors.text),
              decoration: InputDecoration(
                labelText: loc?.t('enroll.enter_id') ?? 'Enter Employee ID',
                prefixIcon: Icon(Icons.badge, color: colors.textSecondary),
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return loc?.t('enroll.error_fields') ??
                      'Please enter both ID and name.';
                }
                return null;
              },
            ),
            const SizedBox(height: 20),
            // Name field
            TextFormField(
              controller: _nameController,
              style: TextStyle(color: colors.text),
              decoration: InputDecoration(
                labelText: loc?.t('enroll.enter_name') ?? 'Enter Name',
                prefixIcon: Icon(Icons.person, color: colors.textSecondary),
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return loc?.t('enroll.error_fields') ??
                      'Please enter both ID and name.';
                }
                return null;
              },
            ),
            const SizedBox(height: 40),
            // Start Enrollment button
            ElevatedButton(
              onPressed: _startEnrollment,
              style: ElevatedButton.styleFrom(
                backgroundColor: colors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                loc?.t('enroll.start') ?? 'Start Enrollment',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCaptureStep(dynamic colors, AppLocalizations? loc) {
    if (!_cameraPermissionGranted) {
      return _buildPermissionRequest(colors, loc);
    }

    return Column(
      children: [
        // Step indicator
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            loc?.t('enroll.step', params: {
                  'current': '${_captureStep + 1}',
                  'total': '3',
                }) ??
                'Step ${_captureStep + 1} of 3',
            style: TextStyle(
              color: colors.text,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        // Camera preview with face guide
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_cameraReady && _cameraController != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: CameraPreview(_cameraController!),
                )
              else
                Center(
                  child: CircularProgressIndicator(color: colors.primary),
                ),
              // Dashed oval face guide overlay
              CustomPaint(
                size: const Size(250, 320),
                painter: _FaceGuideOvalPainter(color: colors.accent),
              ),
              // Instruction text
              Positioned(
                top: 20,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: colors.overlay,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _captureInstructions[_captureStep],
                    style: TextStyle(
                      color: colors.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        // Capture button
        Padding(
          padding: const EdgeInsets.all(24),
          child: ElevatedButton(
            onPressed: _isCapturing ? null : _captureFrame,
            style: ElevatedButton.styleFrom(
              backgroundColor: _isCapturing ? colors.textMuted : colors.primary,
              foregroundColor: Colors.white,
              padding:
                  const EdgeInsets.symmetric(vertical: 16, horizontal: 40),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.pill),
              ),
            ),
            child: Text(
              _isCapturing
                  ? (loc?.t('enroll.capturing') ?? 'Hold still - capturing...')
                  : (loc?.t('enroll.capture_btn') ?? 'Capture'),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildProcessingStep(dynamic colors, AppLocalizations? loc) {
    if (_enrollmentSuccess) {
      return _buildResultBanner(
        colors: colors,
        success: true,
        message: loc?.t('enroll.success') ?? 'Enrollment successful!',
      );
    }

    if (_errorMessage != null) {
      return _buildResultBanner(
        colors: colors,
        success: false,
        message: _errorMessage ?? (loc?.t('enroll.fail') ?? 'Enrollment failed. Please retry.'),
      );
    }

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(color: colors.primary),
          const SizedBox(height: 20),
          Text(
            loc?.t('enroll.processing') ?? 'Processing enrollment...',
            style: TextStyle(
              color: colors.text,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildResultBanner({
    required dynamic colors,
    required bool success,
    required String message,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: success
                    ? colors.success.withOpacity(0.2)
                    : colors.danger.withOpacity(0.2),
              ),
              child: Icon(
                success ? Icons.check_circle : Icons.error,
                size: 48,
                color: success ? colors.success : colors.danger,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              message,
              style: TextStyle(
                color: colors.text,
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: () => context.pop(),
              style: ElevatedButton.styleFrom(
                backgroundColor: colors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                    vertical: 14, horizontal: 32),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                success ? 'Done' : (AppLocalizations.of(context)?.t('common.retry') ?? 'Retry'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPermissionRequest(dynamic colors, AppLocalizations? loc) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.camera_alt_outlined,
              size: 64,
              color: colors.textMuted,
            ),
            const SizedBox(height: 20),
            Text(
              loc?.t('common.camera_required') ??
                  'Camera permission is required',
              style: TextStyle(
                color: colors.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () async {
                final status = await Permission.camera.request();
                if (status.isGranted) {
                  setState(() => _cameraPermissionGranted = true);
                  _initCamera();
                } else if (status.isPermanentlyDenied) {
                  openAppSettings();
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: colors.accent,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(
                    vertical: 14, horizontal: 28),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                loc?.t('common.grant_permission') ?? 'Grant Camera Access',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FaceGuideOvalPainter extends CustomPainter {
  final Color color;

  _FaceGuideOvalPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;

    // Draw dashed oval
    final rect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: size.width * 0.85,
      height: size.height * 0.9,
    );

    const dashLength = 10.0;
    const gapLength = 6.0;

    final path = Path()..addOval(rect);
    final metrics = path.computeMetrics();

    for (final metric in metrics) {
      double distance = 0;
      bool draw = true;
      while (distance < metric.length) {
        final len = draw ? dashLength : gapLength;
        final end = (distance + len).clamp(0.0, metric.length);
        if (draw) {
          final extractedPath = metric.extractPath(distance, end);
          canvas.drawPath(extractedPath, paint);
        }
        distance = end;
        draw = !draw;
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
