import 'package:dio/dio.dart';
import '../models/attendance_event.dart';

class ApiClient {
  late final Dio _dio;
  String? _token;

  ApiClient({String baseUrl = 'http://localhost:8000/api/v1'}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token != null) {
          options.headers['Authorization'] = 'Bearer $_token';
        }
        handler.next(options);
      },
    ));
  }

  Dio get dio => _dio;
  String? get token => _token;

  void setToken(String token) {
    _token = token;
  }

  void clearToken() {
    _token = null;
  }

  Future<String> authenticate(String deviceId, String sharedSecret) async {
    final response = await _dio.post('/auth/device', data: {
      'device_id': deviceId,
      'shared_secret': sharedSecret,
    });
    final token = response.data['token'] as String;
    _token = token;
    return token;
  }

  Future<Map<String, dynamic>> syncAttendanceBatch(
      List<AttendanceEvent> events) async {
    final response = await _dio.post('/attendance/batch', data: {
      'events': events.map((e) => e.toJson()).toList(),
    });
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> syncPunchEvents(
      List<Map<String, dynamic>> events) async {
    final response = await _dio.post('/punch-events/sync', data: {
      'events': events,
    });
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> queryAttendance(
      Map<String, dynamic> filters) async {
    final response = await _dio.get('/attendance', queryParameters: filters);
    return response.data as Map<String, dynamic>;
  }
}
